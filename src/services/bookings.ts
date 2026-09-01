// ── Bookings service ───────────────────────────────────────────────────────
// All Supabase persistence for bookings: reads, recurrence expansion, the public
// request path, admin writes, and shared error normalization. Two trust models
// live here:
//   • Public submit → the submit-booking Edge Function (Turnstile + rate limit +
//     server-side validation). The client never inserts a public booking directly.
//   • Admin actions → RPCs / queries that ASSUME the caller already verified a live
//     admin session; RLS in the database is the real enforcement, not this layer.
import { supabase } from "@/integrations/supabase/client";
import { expandRecurrence, type Booking } from "@/lib/booking-utils";
import { stripHtmlText } from "@/lib/sanitize";

// Explicit column shape matching the app's Booking type — avoids select("*")
// over-fetch (created_at/updated_at) and stays stable as the schema grows.
// approved_by_profile embeds the approver's current display_name via the
// bookings.approved_by → admin_profiles FK, so renames reflect everywhere.
const BOOKING_COLUMNS =
  "id, group_id, title, name, info, start_time, end_time, color_r, color_g, color_b, status, approved_by, approved_by_profile:admin_profiles!bookings_approved_by_fkey(display_name)";

// Admin reads additionally embed the group's kind ('pattern' | 'custom') so the
// admin UI can label a group correctly. Public loads must NOT use this: RLS hides
// booking_groups from anon, and the public calendar has no use for it.
const ADMIN_BOOKING_COLUMNS =
  `${BOOKING_COLUMNS}, booking_group:booking_groups!bookings_group_id_fkey(kind)`;

// Shape of a row selected with BOOKING_COLUMNS: the embeds arrive as nested
// objects (or null) that we flatten onto Booking.approved_by_name / group_kind.
type BookingSelectRow = Omit<Booking, "approved_by_name" | "group_kind"> & {
  approved_by_profile?: { display_name: string | null } | null;
  booking_group?: { kind: string } | null;
};

const mapBookingRow = (row: BookingSelectRow): Booking => {
  const { approved_by_profile, booking_group, ...rest } = row;
  return {
    ...rest,
    approved_by_name: approved_by_profile?.display_name ?? null,
    group_kind: booking_group?.kind === "custom" ? "custom" : booking_group ? "pattern" : null,
  };
};

const mapBookingRows = (rows: BookingSelectRow[] | null): Booking[] =>
  (rows ?? []).map(mapBookingRow);

// RPC rows (RETURNS SETOF bookings) carry approved_by but no joined name; the
// admin page refetches with the embed right after, so null here is transient.
const mapRpcBookingRows = (rows: unknown): Booking[] =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    ...(row as Omit<Booking, "approved_by_name">),
    approved_by_name: null,
  }));

// ── Types ────────────────────────────────────────────────────────────────────
// Only "weekly" remains ("daily"/"monthly" retired — multi-date pick covers them).
// The DB enum stays permissive for any legacy rows.
export type BookingRecurrence = "none" | "weekly";
export type BookingColor = [number, number, number];

export type BookingIntent = {
  title: string;
  name: string;
  info?: string | null;
  start: Date;
  end: Date;
  recurrence: BookingRecurrence;
  recurrenceEnd: string | null;
  // Pick-dates mode: an explicit set of yyyy-MM-dd dates. When present and non-empty
  // this wins over recurrence — each date reuses the shared start/end time-of-day.
  // recurrence stays "none" for this path so the backend groups it as kind='custom'.
  customDates?: string[];
  rgb: BookingColor;
};

export type BookingInstanceInput = {
  start_time: string;
  end_time: string;
};

export type BookingDraft = BookingIntent & {
  turnstileToken: string;
};

export type AdminBookingInsertInput = BookingIntent;

export type BookingUpdateInput = {
  id: string;
  title: string;
  name: string;
  info?: string | null;
  start: Date;
  end: Date;
  rgb: BookingColor;
};

// ── Sanitizing & recurrence expansion ───────────────────────────────────────
const parseRecurrenceEnd = (recurrenceEnd: string | null) => (
  recurrenceEnd ? new Date(`${recurrenceEnd}T23:59:59`) : null
);

const cleanDraft = <T extends Pick<BookingIntent, "title" | "name"> & { info?: string | null }>(input: T) => ({
  ...input,
  title: stripHtmlText(input.title),
  name: stripHtmlText(input.name),
  info: input.info ? stripHtmlText(input.info).trim() || null : null,
});

export const buildBookingRowsFromIntent = (
  input: Pick<BookingIntent, "start" | "end" | "recurrence" | "recurrenceEnd" | "customDates">,
): BookingInstanceInput[] => {
  // Pick-dates mode: one row per selected date, each carrying the shared time-of-day.
  // Duration is preserved as an interval so a cross-midnight booking (end on the next
  // calendar day) lands correctly per date regardless of the placeholder start's date.
  if (input.customDates && input.customDates.length > 0) {
    const durationMs = input.end.getTime() - input.start.getTime();
    const startHour = input.start.getHours();
    const startMinute = input.start.getMinutes();
    // Sort so rows are chronological regardless of the order dates were tapped
    // (yyyy-MM-dd sorts lexicographically = chronologically).
    return [...input.customDates].sort().map((day) => {
      const [y, m, d] = day.split("-").map(Number);
      const rowStart = new Date(y, m - 1, d, startHour, startMinute, 0, 0);
      const rowEnd = new Date(rowStart.getTime() + durationMs);
      return { start_time: rowStart.toISOString(), end_time: rowEnd.toISOString() };
    });
  }

  const instances = input.recurrence === "none"
    ? [{ start: input.start, end: input.end }]
    : expandRecurrence(input.start, input.end, input.recurrence, parseRecurrenceEnd(input.recurrenceEnd));

  return instances.map((instance) => ({
    start_time: instance.start.toISOString(),
    end_time: instance.end.toISOString(),
  }));
};

// ── Error normalization ──────────────────────────────────────────────────────
// Server (Postgres/RPC) and Edge Function failures arrive as opaque strings. Map
// the known ones to safe, user-facing copy; everything else falls back to a generic
// message so internal details (constraint names, SQL, stack) never reach the user.
const messageFromUnknown = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

export const normalizeBookingError = (error: unknown, fallback: string) => {
  const message = messageFromUnknown(error);
  if (/too many booking requests|rate limit|try again later/i.test(message)) {
    return "Too many booking requests. Please try again later.";
  }
  if (/verification|turnstile|challenge/i.test(message)) {
    return "Verification failed or expired. Please complete the challenge again.";
  }
  if (/info.*(?:200|400)|(?:200|400) characters/i.test(message)) {
    return "Info must be 400 characters or fewer.";
  }
  if (/conflict|overlap|exclude constraint|no_approved_overlap|no longer available/i.test(message)) {
    return "That time is no longer available.";
  }
  // Punctuated to match validation.endAfterStart exactly, so the same problem reads
  // identically whether the client caught it or the server did.
  if (/end time must be after start time/i.test(message)) {
    return "End time must be after start time.";
  }
  // Field-length and request-bound rejections from submit_booking_request. The UI
  // makes these unreachable (maxLength + validate() + floored date pickers), so in
  // practice they only surface for a clock-skewed device or a direct API call —
  // but a generic "could not submit" leaves a real user with nothing to act on.
  // These exact strings are ours (see the submit_booking_request migration), and the
  // Edge Function's cleanErrorMessage already gate-keeps what reaches us.
  if (/characters or fewer|within the next|shorter than \d+ days|between 1 and \d+ sessions|start and end time/i.test(message)) {
    return message;
  }
  return fallback;
};

// A submission failure tagged with WHY it failed, so the UI can respond correctly.
// The distinction is load-bearing for the public Turnstile sub-flow: a "conflict" or
// "rate_limit" is a real, terminal outcome to show on the form — it must NOT re-run
// the Turnstile challenge (doing so trapped users in a "verification failed" loop for
// what was really a taken slot). Only "verification" should reset the widget.
export type BookingSubmitErrorCode = "conflict" | "rate_limit" | "verification" | "unknown";

export class BookingSubmitError extends Error {
  readonly code: BookingSubmitErrorCode;
  constructor(message: string, code: BookingSubmitErrorCode) {
    super(message);
    this.name = "BookingSubmitError";
    this.code = code;
  }
}

// Classify from the RAW server/Edge string (before normalization) — it carries the
// specific wording ("overlaps an approved booking", Turnstile error codes, etc.).
const classifyBookingError = (rawMessage: string): BookingSubmitErrorCode => {
  if (/too many booking requests|rate limit|try again later/i.test(rawMessage)) return "rate_limit";
  if (/verification|turnstile|challenge/i.test(rawMessage)) return "verification";
  if (/conflict|overlap|exclude constraint|no_approved_overlap|no longer available/i.test(rawMessage)) return "conflict";
  return "unknown";
};

export const readFunctionErrorMessage = async (error: unknown, fallback: string) => {
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Keep the safe fallback below.
    }
  }
  return messageFromUnknown(error) || fallback;
};

const throwBookingError = (error: unknown, fallback: string): never => {
  throw new Error(normalizeBookingError(error, fallback));
};

// ── Reads ────────────────────────────────────────────────────────────────────
// slackDays pads the window a day on each side so a booking that straddles the
// week boundary isn't dropped from the calendar.
export const loadApprovedBookingsForWindow = async ({
  startTime,
  endTime,
  slackDays = 1,
  limit = 200,
}: {
  startTime: number;
  endTime: number;
  slackDays?: number;
  limit?: number;
}) => {
  const from = new Date(startTime);
  from.setDate(from.getDate() - slackDays);
  const to = new Date(endTime);
  to.setDate(to.getDate() + slackDays);

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("status", "approved")
    .lte("start_time", to.toISOString())
    .gte("end_time", from.toISOString())
    .order("start_time", { ascending: true })
    .limit(limit);

  if (error) throwBookingError(error, "Could not load bookings.");
  return mapBookingRows(data as BookingSelectRow[] | null);
};

export const loadTodayApprovedBookings = async ({ limit = 20 }: { limit?: number } = {}) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("status", "approved")
    .lte("start_time", end.toISOString())
    .gte("end_time", start.toISOString())
    .order("start_time", { ascending: true })
    .limit(limit);

  if (error) throwBookingError(error, "Could not load today’s bookings.");
  return mapBookingRows(data as BookingSelectRow[] | null);
};

// The admin surface derives EVERY view (pending queue, approved upcoming/past)
// from this one array, so a row missing here is simply invisible to the admin.
//
// Two queries with independent budgets, deliberately. A single shared budget
// ordered by start_time meant one status could evict the other: `pending` is the
// only attacker-reachable status (the public path cannot create `approved`), so a
// burst of requests would push real approved bookings out of the query — and,
// before the range bounds landed server-side, junk dated in the past sorted FIRST
// and pushed out nearly everything. Split budgets mean neither can starve the other.
export const loadAdminBookings = async ({
  pendingLimit = 300,
  decidedLimit = 500,
}: { pendingLimit?: number; decidedLimit?: number } = {}) => {
  const [pendingResult, decidedResult] = await Promise.all([
    supabase
      .from("bookings")
      .select(ADMIN_BOOKING_COLUMNS)
      .eq("status", "pending")
      .order("start_time", { ascending: true })
      .limit(pendingLimit),
    // approved + rejected: not publicly writable, so ordering here can't be gamed.
    supabase
      .from("bookings")
      .select(ADMIN_BOOKING_COLUMNS)
      .neq("status", "pending")
      .order("start_time", { ascending: true })
      .limit(decidedLimit),
  ]);

  const error = pendingResult.error ?? decidedResult.error;
  if (error) throwBookingError(error, "Could not load bookings.");

  const rows = [
    ...((pendingResult.data ?? []) as BookingSelectRow[]),
    ...((decidedResult.data ?? []) as BookingSelectRow[]),
  ];
  // Restore the single chronological order the admin views expect — the callers
  // filter this array by status, they don't assume it arrives grouped. Compared as
  // instants, not strings: timestamptz can come back with differing offsets, where
  // a lexicographic compare would silently misorder.
  rows.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  return mapBookingRows(rows);
};

// ── Admin writes (assume a verified live session; RLS enforces it) ───────────
export const updateBooking = async (input: BookingUpdateInput) => {
  const clean = cleanDraft(input);
  const { data, error } = await supabase
    .from("bookings")
    .update({
      title: clean.title,
      name: clean.name,
      info: clean.info,
      start_time: input.start.toISOString(),
      end_time: input.end.toISOString(),
      color_r: input.rgb[0],
      color_g: input.rgb[1],
      color_b: input.rgb[2],
    })
    .eq("id", input.id)
    .select(BOOKING_COLUMNS)
    .single();

  if (error) throwBookingError(error, "Could not save booking.");
  return mapBookingRow(data as BookingSelectRow);
};

export const createApprovedAdminBookings = async (input: AdminBookingInsertInput) => {
  // Assumes the caller has already verified a live admin session. The group +
  // bookings are inserted atomically by the create_approved_booking_series RPC
  // (SECURITY INVOKER — RLS enforces admin), so a partial failure can't orphan
  // a booking_group.
  const clean = cleanDraft(input);
  const rows = buildBookingRowsFromIntent(input);

  const { data, error } = await supabase.rpc("create_approved_booking_series", {
    payload: {
      title: clean.title,
      name: clean.name,
      info: clean.info,
      recurrence: input.recurrence,
      recurrence_end: input.recurrenceEnd || null,
      color_r: input.rgb[0],
      color_g: input.rgb[1],
      color_b: input.rgb[2],
      bookings: rows,
    },
  });

  if (error) throwBookingError(error, "Could not save booking.");
  return mapRpcBookingRows(data);
};

// ── Public request path ──────────────────────────────────────────────────────
// Routed through the submit-booking Edge Function (not a direct insert) so the
// Turnstile token, rate limit, and payload validation are enforced server-side.
// Returns sessionCount so the UI can confirm how many slots a recurrence created.
export const submitPublicBookingRequest = async (input: BookingDraft) => {
  const clean = cleanDraft(input);
  const rows = buildBookingRowsFromIntent(input);

  const { data, error } = await supabase.functions.invoke("submit-booking", {
    body: {
      turnstileToken: input.turnstileToken,
      booking: {
        title: clean.title,
        name: clean.name,
        info: clean.info,
        recurrence: input.recurrence,
        recurrence_end: input.recurrenceEnd || null,
        color_r: input.rgb[0],
        color_g: input.rgb[1],
        color_b: input.rgb[2],
        bookings: rows,
      },
    },
  });

  if (error) {
    // Intentional and load-bearing: Edge Function response strings are part of
    // the client error contract. Update this alongside submit-booking responses.
    const message = await readFunctionErrorMessage(error, "Could not submit booking request.");
    throw new BookingSubmitError(
      normalizeBookingError(message, "Could not submit booking request."),
      classifyBookingError(message),
    );
  }
  if (data && typeof data === "object" && "error" in data) {
    const raw = String(data.error);
    throw new BookingSubmitError(
      normalizeBookingError(raw, "Could not submit booking request."),
      classifyBookingError(raw),
    );
  }

  return { sessionCount: rows.length };
};

// ── Deletes ──────────────────────────────────────────────────────────────────
export const deletePendingBooking = async (bookingId: string) => {
  const { error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("status", "pending");

  if (error) throwBookingError(error, "Could not delete booking.");
};

export const deleteBooking = async (bookingId: string) => {
  const { error } = await supabase.from("bookings").delete().eq("id", bookingId);
  if (error) throwBookingError(error, "Could not delete booking.");
};

export const deleteBookingAndFollowingOccurrences = async (groupId: string, startTime: string) => {
  const { error } = await supabase
    .from("bookings")
    .delete()
    .eq("group_id", groupId)
    .gte("start_time", startTime);

  if (error) throwBookingError(error, "Could not delete booking.");
};

export const deleteBookingSeries = async (groupId: string) => {
  const { error } = await supabase.from("bookings").delete().eq("group_id", groupId);
  if (error) throwBookingError(error, "Could not delete booking.");
};

// ── Approvals ────────────────────────────────────────────────────────────────
// "Overwrite" variants approve the pending request AND remove the approved
// booking(s) it conflicts with — the admin resolving a double-book in one step.
// The group variant returns how many conflicting bookings it cleared.
export const approveBooking = async (bookingId: string) => {
  const { error } = await supabase.rpc("approve_booking", { _booking_id: bookingId });
  if (error) throwBookingError(error, "Could not approve booking.");
};

// Atomic, no-overwrite group approval: every instance approves in one transaction,
// or none do (a clash with an approved booking trips no_approved_overlap and aborts).
// The overwrite RPCs are gone — an Approve never bumps an approved booking.
export const approveBookingGroup = async (groupId: string) => {
  const { error } = await supabase.rpc("approve_booking_group", { _group_id: groupId });
  if (error) throwBookingError(error, "Could not approve booking.");
};
