// The safety-net reminder: a second admin-chat message for a request still pending
// close to its first session. The rule is in _shared/booking-reminder.ts.
//
// NOT a public function: omitted from config.toml so the gateway keeps the platform
// default verify_jwt = true (the cron sends Bearer <anon key>), and the real guard is
// the x-telegram-trigger-secret header, which only the DB-side cron knows.
//
// Runs once a day and never retries, because a retry could duplicate a reminder. A
// missed day means no reminder for that day's requests, so every run reports to
// Healthchecks.io, even with nothing to send, and a failed send reports a failure.
// A crash reports nothing, and the check then alerts as down.

import { createClient } from "npm:@supabase/supabase-js@2";
import { groupPendingRequests, requestsToRemind, type PendingBookingRow } from "../_shared/booking-reminder.ts";
import { reportHealth } from "../_shared/health.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";
import { buildAdminReminderMessage } from "../_shared/telegram-format.ts";

const CHECK_NAME = "telegram-reminder";

// The same cap as submit-booking's pending count; the queue never gets near it.
const MAX_PENDING_ROWS = 2000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const handler = async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Fail closed: no configured secret means nothing can invoke this.
  const triggerSecret = Deno.env.get("TELEGRAM_TRIGGER_SECRET");
  if (!triggerSecret || req.headers.get("x-telegram-trigger-secret") !== triggerSecret) {
    return json({ error: "Forbidden" }, 403);
  }

  const chatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
  const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
  if (!chatId || !siteUrl) {
    console.warn("telegram-reminder skipped: TELEGRAM_ADMIN_CHAT_ID or SITE_URL not set");
    await reportHealth(CHECK_NAME, false, "TELEGRAM_ADMIN_CHAT_ID or SITE_URL missing");
    return json({ ok: false, reason: "not configured" });
  }
  const threadId = Deno.env.get("TELEGRAM_ADMIN_THREAD_ID") || undefined;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("bookings")
    .select("id, group_id, title, name, start_time, end_time, created_at, booking_groups(recurrence)")
    .eq("status", "pending")
    .order("start_time", { ascending: true })
    .limit(MAX_PENDING_ROWS);
  if (error) {
    console.error("telegram-reminder pending query failed:", error.message);
    await reportHealth(CHECK_NAME, false, "pending query failed");
    return json({ ok: false, reason: "pending query failed" }, 500);
  }

  const pending = groupPendingRequests((data ?? []) as unknown as PendingBookingRow[]);
  const due = requestsToRemind(pending, new Date());

  let failed = 0;
  for (const request of due) {
    const result = await sendTelegramMessage({
      chatId,
      threadId,
      parseMode: "HTML",
      text: buildAdminReminderMessage({
        ...request,
        reviewUrl: `${siteUrl}/?admin=login&next=/admin`,
        pendingCount: pending.length,
      }),
    });
    // sendTelegramMessage already logged Telegram's description (never the token).
    if (!result.ok) failed += 1;
  }

  const sent = due.length - failed;
  await reportHealth(CHECK_NAME, failed === 0, `${sent} sent, ${failed} failed`);
  return json({ ok: failed === 0, sent, failed });
};

// Exported so tests can call it; serving stays unconditional so the runtime never
// depends on how it marks the entry module.
Deno.serve(handler);
