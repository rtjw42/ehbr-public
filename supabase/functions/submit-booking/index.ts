import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cleanErrorMessage,
  getClientIp,
  handleCors,
  hashSubject,
  isWarmupRequest,
  json,
  rateLimitBlocked,
  rateLimitHit,
  readJsonBody,
  statusForMessage,
  stripHtmlText,
  verifyTurnstile,
  warmupResponse,
} from "../_shared/security.ts";
import { buildAdminRequestMessage, type TelegramBookingRow } from "../_shared/telegram-format.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";
import { containsLink, sanitizeFreeText } from "../_shared/text-guard.ts";

const MAX_JSON_BODY_BYTES = 128 * 1024;

// C1: ping the admin chat about a new public request. Best-effort and awaited
// (sendTelegramMessage is bounded by its own 5s timeout and never throws) —
// only public submissions come through this function, so admins creating
// approved bookings via create_approved_booking_series never notify themselves.
const notifyAdminChat = async (
  origin: string,
  booking: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
) => {
  const chatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
  if (!chatId) return;
  const threadId = Deno.env.get("TELEGRAM_ADMIN_THREAD_ID") || undefined;

  const rows = Array.isArray(booking.bookings)
    ? (booking.bookings as TelegramBookingRow[]).filter(
        (row) => typeof row?.start_time === "string" && typeof row?.end_time === "string",
      )
    : [];
  if (rows.length === 0) return;

  // Total pending REQUESTS awaiting approval (this one included), matching how an
  // admin reads the queue: a grouped request counts once, singles count once each.
  // Best-effort — a failed/absent count just omits the line (see builder).
  let pendingCount: number | undefined;
  const { data: pendingRows, error: pendingError } = await supabase
    .from("bookings")
    .select("group_id")
    .eq("status", "pending")
    .limit(2000);
  if (pendingError) {
    console.error("pending count query failed:", pendingError.message);
  } else if (pendingRows) {
    const groups = new Set<string>();
    let singles = 0;
    for (const row of pendingRows as { group_id: string | null }[]) {
      if (row.group_id) groups.add(row.group_id);
      else singles += 1;
    }
    pendingCount = groups.size + singles;
  }

  const base = origin || Deno.env.get("SITE_URL") || "";
  const recurrence = booking.recurrence;
  const text = buildAdminRequestMessage({
    title: typeof booking.title === "string" ? booking.title : "",
    name: typeof booking.name === "string" ? booking.name : "",
    info: typeof booking.info === "string" ? booking.info : "",
    recurrence: recurrence === "weekly" ? "weekly" : "none",
    rows,
    reviewUrl: `${base}/?admin=login&next=/admin`,
    pendingCount,
  });
  await sendTelegramMessage({ chatId, text, threadId, parseMode: "HTML" });
};

Deno.serve(async (req) => {
  if (isWarmupRequest(req)) return warmupResponse();

  const cors = handleCors(req);
  if (cors.response) return cors.response;
  const { origin } = cors;

  if (req.method !== "POST") {
    return json(origin, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("submit-booking missing Supabase environment");
    return json(origin, { error: "Could not submit booking request." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const ip = getClientIp(req);
    const ipHash = await hashSubject(ip);
    // Cap COMMITTED bookings per IP, not raw attempts. 120 / 10 min is generous because
    // a whole hall books from one shared NUS/NAT address; the real spam gates are
    // Turnstile + admin approval. This is a read-only check — the hit is recorded only
    // after a booking actually commits (below), so Turnstile/validation/conflict
    // failures never burn the shared budget. One person retrying a taken slot can't
    // lock everyone else out during a release window.
    const blocked = await rateLimitBlocked(supabase, "submit-booking", ipHash, 120);
    if (blocked) {
      return json(origin, { error: "Too many booking requests. Please try again later." }, 429);
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
    } catch (error) {
      if (error instanceof Error && /too large/i.test(error.message)) {
        return json(origin, { error: "Request body is too large." }, 413);
      }
      return json(origin, { error: "Invalid booking request." }, 400);
    }

    const turnstileToken = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
    const booking = body?.booking;

    if (!turnstileToken) {
      return json(origin, { error: "Please complete the verification challenge." }, 400);
    }
    if (!booking || typeof booking !== "object") {
      return json(origin, { error: "Invalid booking request." }, 400);
    }

    await verifyTurnstile(turnstileToken, ip, { scope: "submit-booking", ipHash });

    const raw = booking as Record<string, unknown>;
    // Strip HTML, then neutralize invisible/bidi chars + whitespace flooding.
    const safeTitle = sanitizeFreeText(stripHtmlText(raw.title));
    const safeName = sanitizeFreeText(stripHtmlText(raw.name));
    const safeInfo = sanitizeFreeText(stripHtmlText(raw.info), true);

    // Reject links/handles at the boundary: this text is pushed to the admin +
    // band-chat Telegram boards, where Telegram auto-linkifies bare URLs and
    // @mentions regardless of parse_mode — a phishing/spam vector on an anonymous
    // public form. HTML-escaping downstream does not stop it; blocking here does.
    if (containsLink(safeTitle) || containsLink(safeName) || containsLink(safeInfo)) {
      return json(
        origin,
        { error: "Links aren't allowed in a booking. Please remove any web addresses, @handles, or t.me links." },
        400,
      );
    }

    // Build the RPC payload from an explicit ALLOW-LIST rather than spreading the
    // client object. submit_booking_request already reads only these keys and
    // hardcodes status = 'pending', so spreading was safe — but it left this
    // boundary with no field-level opinion at all, so the safety lived entirely in
    // another file. Naming the fields here makes `status` (and anything else a
    // client invents) un-passable at the edge, not merely ignored downstream.
    const safeBooking = {
      title: safeTitle,
      name: safeName,
      info: safeInfo,
      recurrence: raw.recurrence,
      recurrence_end: raw.recurrence_end,
      color_r: raw.color_r,
      color_g: raw.color_g,
      color_b: raw.color_b,
      bookings: raw.bookings,
    };

    const { data, error } = await supabase.rpc("submit_booking_request", { payload: safeBooking });
    if (error) {
      console.error("submit_booking_request failed", error.message);
      const message = cleanErrorMessage(error, "Could not submit booking request.");
      return json(origin, { error: message }, statusForMessage(message));
    }

    // Record the rate-limit hit only now that a booking has committed, so the limit
    // counts real bookings — not the doomed attempts above. Best-effort: a bookkeeping
    // error (or being exactly at the ceiling) must never fail an already-saved booking.
    try {
      const recorded = await rateLimitHit(supabase, "submit-booking", ipHash, 120);
      if (!recorded) {
        console.warn("[rate-limit] submit-booking at ceiling; hit not recorded", JSON.stringify({ ipHash }));
      }
    } catch (rlError) {
      console.error("rate limit record failed:", rlError instanceof Error ? rlError.message : String(rlError));
    }

    try {
      await notifyAdminChat(origin, safeBooking, supabase);
    } catch (notifyError) {
      // Never let a notification problem fail an already-committed booking.
      console.error(
        "telegram admin notify failed:",
        notifyError instanceof Error ? notifyError.message : String(notifyError),
      );
    }

    return json(origin, { ok: true, data });
  } catch (error) {
    console.error("submit-booking error", error);
    const message = cleanErrorMessage(error, "Could not submit booking request.");
    return json(origin, { error: message }, statusForMessage(message));
  }
});
