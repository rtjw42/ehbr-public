// C2: rebuild the band-chat weekly board from live DB state and post it.
//
// NOT a public function: omitted from config.toml so the gateway keeps the
// platform default verify_jwt = true (the drain sends Bearer <anon key>), and
// the real guard is the x-telegram-trigger-secret header — only the DB-side
// pg_cron drain (reading the same value from Vault) knows it. Outbound-only:
// this function only ever reads bookings and sends to Telegram; there is no
// inbound path, no webhook, no buttons.
//
// Delivery (TELEGRAM_BOARD_MODE):
//   edit (default) — silent editMessageText of the stored message; self-heal:
//     if the edit fails for any reason other than "not modified", send a fresh
//     silent message and overwrite the stored id. No delete, ever.
//   announce — send a fresh (notifying) message each drain; no edit/delete.
//
// Dirty-flag contract (claim-then-send): the drain fires only when `dirty` is
// set; we flip it false up front — so an approval landing mid-send re-dirties
// and re-sends next tick instead of being lost — and re-set it on failure so a
// Telegram outage gets a free retry next minute.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildWeeklyBoardMessage, NEXT_WEEK_ANNOUNCEMENT, sgtBoardWeekWindow, type TelegramBoardRow } from "../_shared/telegram-format.ts";
import { editTelegramMessage, sendTelegramMessage, type TelegramResult } from "../_shared/telegram.ts";

// A week's board is tiny, but cap the query defensively (CLAUDE.md: every
// read has a .limit()). 500 approved rows in one week will never happen.
const MAX_WEEK_ROWS = 500;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Fail closed: no configured secret means nothing can invoke this.
  const triggerSecret = Deno.env.get("TELEGRAM_TRIGGER_SECRET");
  if (!triggerSecret || req.headers.get("x-telegram-trigger-secret") !== triggerSecret) {
    return json({ error: "Forbidden" }, 403);
  }

  const chatId = Deno.env.get("TELEGRAM_BOARD_CHAT_ID");
  if (!chatId) {
    console.warn("telegram-weekly skipped: TELEGRAM_BOARD_CHAT_ID not set");
    return json({ ok: false, reason: "not configured" });
  }
  const mode = Deno.env.get("TELEGRAM_BOARD_MODE") === "announce" ? "announce" : "edit";
  const threadId = Deno.env.get("TELEGRAM_BOARD_THREAD_ID") || undefined;
  // The board's calendar link. SITE_URL is required (no hardcoded fallback, so
  // no domain is committed); trailing slash trimmed so we don't emit //.
  const bookingUrl = `${(Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "")}/bookings`;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Claim the dirty flag before sending (see contract in the header comment).
  const { data: stateRows, error: stateError } = await supabase
    .from("telegram_channel_state")
    .update({ dirty: false, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select("message_id, chat_id, week_start")
    .limit(1);
  if (stateError) {
    console.error("telegram-weekly state read failed:", stateError.message);
    return json({ ok: false, reason: "state read failed" }, 500);
  }
  const state = stateRows?.[0] as
    | { message_id: number | null; chat_id: string | null; week_start: string | null }
    | undefined;

  const now = new Date();
  const { start, end } = sgtBoardWeekWindow(now);
  const weekStartIso = start.toISOString();
  // A fresh board is posted for each new board-week (or first-ever post); edits
  // only reuse the stored message when it belongs to the current board-week and
  // same chat.
  const sameWeek =
    state?.week_start != null && new Date(state.week_start).getTime() === start.getTime();
  // A genuine weekly rollover: a prior week existed and it just advanced. Only
  // then do we send the "Next week's bookings!" ping — never on first-ever post,
  // self-heal, or chat re-point.
  const isWeeklyRollover = mode === "edit" && state?.week_start != null && !sameWeek;

  // Approved bookings overlapping the window ([start, end) on both sides).
  const { data: bookingRows, error: bookingsError } = await supabase
    .from("bookings")
    .select("title, name, start_time, end_time")
    .eq("status", "approved")
    .lt("start_time", end.toISOString())
    .gt("end_time", start.toISOString())
    .order("start_time", { ascending: true })
    .limit(MAX_WEEK_ROWS);

  const markDirty = () =>
    supabase.from("telegram_channel_state").update({ dirty: true }).eq("id", 1).select("id").limit(1);

  if (bookingsError) {
    console.error("telegram-weekly bookings query failed:", bookingsError.message);
    await markDirty();
    return json({ ok: false, reason: "bookings query failed" }, 500);
  }

  const text = buildWeeklyBoardMessage({ now, rows: (bookingRows ?? []) as TelegramBoardRow[], bookingUrl });

  // ── Deliver ────────────────────────────────────────────────────────────────
  let result: TelegramResult;
  let deliveredMessageId: number | undefined;

  if (mode === "edit" && sameWeek && state?.message_id && state.chat_id === chatId) {
    result = await editTelegramMessage({ chatId, messageId: state.message_id, text, parseMode: "HTML" });
    if (result.ok) {
      deliveredMessageId = state.message_id;
    } else if (result.description?.includes("message is not modified")) {
      // The posted board already matches (e.g. a retried drain) — success.
      result = { ok: true };
      deliveredMessageId = state.message_id;
    } else {
      // Self-heal: send fresh (still silent) and overwrite the stored id below.
      console.warn("telegram-weekly edit failed, sending fresh:", result.description);
      result = await sendTelegramMessage({ chatId, text, threadId, parseMode: "HTML", disableNotification: true });
      deliveredMessageId = result.messageId;
    }
  } else {
    // First post, a new week, chat re-pointed, or announce mode. On a genuine
    // weekly rollover, send a short "Next week's bookings!" ping first (its own
    // message, not tracked/edited), then the board silently — one ping per week.
    // Best-effort: a failed announcement never blocks the board.
    if (isWeeklyRollover) {
      const announce = await sendTelegramMessage({
        chatId,
        text: NEXT_WEEK_ANNOUNCEMENT,
        threadId,
        parseMode: "HTML",
        disableNotification: false,
      });
      if (!announce.ok) console.warn("telegram-weekly next-week ping failed:", announce.description);
    }
    // announce mode notifies; edit mode stays silent for its fresh board (the
    // rollover ping above is the notification).
    result = await sendTelegramMessage({
      chatId,
      text,
      threadId,
      parseMode: "HTML",
      disableNotification: mode === "edit",
    });
    deliveredMessageId = result.messageId;
  }

  if (!result.ok) {
    // sendTelegramMessage already logged Telegram's description (never the token).
    await markDirty();
    return json({ ok: false, reason: "send failed" });
  }

  if (deliveredMessageId) {
    const { error: storeError } = await supabase
      .from("telegram_channel_state")
      .update({
        message_id: deliveredMessageId,
        chat_id: chatId,
        week_start: weekStartIso,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("id")
      .limit(1);
    if (storeError) console.error("telegram-weekly state store failed:", storeError.message);
  }

  return json({ ok: true, mode });
});
