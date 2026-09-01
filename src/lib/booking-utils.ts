// ── Booking utilities ────────────────────────────────────────────────────────
// Pure, shared helpers for the calendar: the Booking shape, week/day math, day &
// window intersection, color styling, recurrence expansion, and the realtime merge.
// No Supabase here — all persistence lives in services/bookings.ts.
import { addDays, startOfWeek, endOfWeek, format, isSameDay, startOfDay, addMinutes, addWeeks } from "date-fns";
import { formatClockTime, formatDateAtTime, formatLocalizedDate, getDateLocale } from "@/lib/date";

export type Booking = {
  id: string;
  group_id: string | null;
  title: string;
  name: string;
  info: string | null;
  start_time: string; // ISO
  end_time: string;   // ISO
  color_r: number;
  color_g: number;
  color_b: number;
  status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  // Flattened from the admin_profiles embed on reads; null on optimistic/RPC rows
  // that didn't join the profile (the next refetch fills it in).
  approved_by_name: string | null;
  // Flattened from the booking_groups embed on ADMIN reads only (public loads never
  // join booking_groups — RLS hides it from anon anyway). Lets admin UI label a
  // group "Recurring series" vs "N dates" without inferring from the instances.
  group_kind?: "pattern" | "custom" | null;
};

// ── Week & date formatting ───────────────────────────────────────────────────
// Week authority (client): Monday–Sunday, computed in the *device* timezone via
// date-fns. The band is Singapore-based, so device time == SGT for real users and
// this agrees with the server's SGT week window (`sgtWeekWindow` in
// supabase/functions/_shared/telegram-format.ts), which the Telegram board uses.
// The two only diverge for a device set to a non-SGT timezone, near the Sun/Mon
// midnight boundary — accepted at pilot scale. Keep these two the single Mon–Sun
// rule; if one changes, change the other.
export function getWeekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekRange(anchor: Date) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const end = endOfWeek(anchor, { weekStartsOn: 1 });
  return { start, end };
}

export function fmtWeekLabel(anchor: Date, language = "en") {
  const { start, end } = weekRange(anchor);
  const sameMonth = start.getMonth() === end.getMonth();
  const dateLocale = getDateLocale(language);
  if (language === "zh") {
    if (start.getFullYear() === end.getFullYear() && sameMonth) {
      return `${format(start, "yyyy 年 M 月 d 日", { locale: dateLocale })} 至 ${format(end, "d 日", { locale: dateLocale })}`;
    }
    if (start.getFullYear() === end.getFullYear()) {
      return `${format(start, "yyyy 年 M 月 d 日", { locale: dateLocale })} 至 ${format(end, "M 月 d 日", { locale: dateLocale })}`;
    }
    return `${format(start, "yyyy 年 M 月 d 日", { locale: dateLocale })} 至 ${format(end, "yyyy 年 M 月 d 日", { locale: dateLocale })}`;
  }
  return sameMonth
    ? `${format(start, "MMM d", { locale: dateLocale })} – ${format(end, "d, yyyy", { locale: dateLocale })}`
    : `${format(start, "MMM d", { locale: dateLocale })} – ${format(end, "MMM d, yyyy", { locale: dateLocale })}`;
}

export function fmtDateTime(value: string | Date, language = "en", includeYear = false) {
  const date = typeof value === "string" ? new Date(value) : value;
  return formatDateAtTime(
    date,
    language,
    includeYear ? "EEE, MMM d, yyyy" : "EEE, MMM d",
    includeYear ? "yyyy 年 M 月 d 日 EEE" : "M 月 d 日 EEE",
    " ",
  );
}

export function fmtDate(value: string | Date, language = "en", includeYear = false) {
  const date = typeof value === "string" ? new Date(value) : value;
  return formatLocalizedDate(
    date,
    language,
    includeYear ? "MMM d, yyyy" : "MMM d",
    includeYear ? "yyyy 年 M 月 d 日" : "M 月 d 日",
  );
}

// ── Multi-day span (one booking that crosses midnight) ───────────────────────
// A booking occupies [start, end); comparing against end-1ms means one ending
// exactly at midnight stays single-day (it doesn't spill onto the next date).
export function isMultiDay(start: Date, end: Date) {
  return !isSameDay(start, new Date(end.getTime() - 1));
}

// True when a booking's slice for the given day has already finished, so the
// calendar chip can dim it. The slice end is the earlier of the booking's end
// and the day's midnight boundary — that way a fully-past day of a multi-day
// booking dims too, while a later day of the same booking stays live.
export function isBookingOver(booking: Pick<Booking, "end_time">, day: Date, now: Date = new Date()) {
  const sliceEnd = Math.min(new Date(booking.end_time).getTime(), addDays(startOfDay(day), 1).getTime());
  return sliceEnd <= now.getTime();
}

// "Mon 6 Jul, 03:00 → Wed 8 Jul, 05:00". Times route through formatClockTime (the
// single clock authority) so they follow the app's 24h/12h convention. Only used
// when isMultiDay is true — the flat list/summary views that would otherwise show
// just the start date + start–end clock times, misreading a multi-day booking.
export function fmtBookingSpan(start: Date, end: Date, language = "en") {
  const datePart = (d: Date) => formatLocalizedDate(d, language, "EEE d MMM", "M 月 d 日 EEE");
  return `${datePart(start)}, ${formatClockTime(start, language)} → ${datePart(end)}, ${formatClockTime(end, language)}`;
}

// ── Day / window intersection & realtime merge ───────────────────────────────
/** Returns bookings that intersect a given day, with a flag for "continued". */
export function bookingsForDay(bookings: Booking[], day: Date) {
  const ds = startOfDay(day);
  const de = addDays(ds, 1);
  return bookings
    .filter((b) => {
      const s = new Date(b.start_time);
      const e = new Date(b.end_time);
      return s < de && e > ds;
    })
    .map((b) => {
      const s = new Date(b.start_time);
      const isContinued = !isSameDay(s, day) && s < ds;
      return { booking: b, isContinued };
    })
    .sort((a, b) => new Date(a.booking.start_time).getTime() - new Date(b.booking.start_time).getTime());
}

export function bookingIntersectsWindow(booking: Pick<Booking, "start_time" | "end_time">, startTime: number, endTime: number) {
  const start = new Date(booking.start_time).getTime();
  const end = new Date(booking.end_time).getTime();
  return start < endTime && end > startTime;
}

// Reconcile a fresh fetch with the current list: keep only approved bookings still
// inside the window, dedupe by id (incoming wins), and re-sort. Lets an optimistic
// local state converge to server truth without flicker.
export function mergeVisibleApprovedBookings(
  previous: Booking[],
  incoming: Booking[],
  startTime: number,
  endTime: number,
) {
  const incomingIds = new Set(incoming.map((booking) => booking.id));
  const byId = new Map<string, Booking>();

  previous.forEach((booking) => {
    if (incomingIds.has(booking.id)) return;
    if (booking.status !== "approved") return;
    if (!bookingIntersectsWindow(booking, startTime, endTime)) return;
    byId.set(booking.id, booking);
  });

  incoming.forEach((booking) => {
    if (booking.status !== "approved") return;
    if (!bookingIntersectsWindow(booking, startTime, endTime)) return;
    byId.set(booking.id, booking);
  });

  return Array.from(byId.values()).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

// Cross-component signal: when an admin approves/deletes, this lets other mounted
// views (e.g. the landing snapshot) update from the detail payload without each
// holding its own query or waiting on the realtime round-trip.
export const BOOKING_APPROVED_CHANGED_EVENT = "booking:approved-changed";

export type BookingApprovedChangedEvent = CustomEvent<{
  bookings?: Booking[];
  deletedIds?: string[];
}>;

export function dispatchBookingApprovedChanged(detail: { bookings?: Booking[]; deletedIds?: string[] }) {
  if (typeof window === "undefined") return;
  const hasBookings = (detail.bookings?.length ?? 0) > 0;
  const hasDeletedIds = (detail.deletedIds?.length ?? 0) > 0;
  if (!hasBookings && !hasDeletedIds) return;
  window.dispatchEvent(new CustomEvent(BOOKING_APPROVED_CHANGED_EVENT, { detail }));
}

export function fmtTimeRange(b: Booking, day?: Date, language = "en") {
  const s = new Date(b.start_time);
  const e = new Date(b.end_time);
  if (day) {
    const ds = startOfDay(day);
    const de = addDays(ds, 1);
    // Clamp multi-day edges to this day's midnight boundaries, then render via
    // the clock authority so the 12h/24h preference applies to the clamp too.
    return `${formatClockTime(s < ds ? ds : s, language)}–${formatClockTime(e > de ? de : e, language)}`;
  }
  return `${formatClockTime(s, language)}–${formatClockTime(e, language)}`;
}

export function bookingBg(b: Pick<Booking, "color_r" | "color_g" | "color_b">) {
  return `rgba(${b.color_r}, ${b.color_g}, ${b.color_b}, 0.22)`;
}
export function bookingBorder(b: Pick<Booking, "color_r" | "color_g" | "color_b">) {
  return `rgba(${b.color_r}, ${b.color_g}, ${b.color_b}, 0.65)`;
}
export function bookingDot(b: Pick<Booking, "color_r" | "color_g" | "color_b">) {
  return `rgb(${b.color_r}, ${b.color_g}, ${b.color_b})`;
}

// Half-open interval overlap on epoch ms. The numeric form exists for the hot
// paths (calendar availability, the conflict scan), which compare one span against
// hundreds of bookings — re-parsing each booking's ISO strings into Dates per
// comparison was the dominant cost there. `overlaps` delegates to it so the Date
// and ms forms can never drift apart.
export function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return overlapsMs(aStart.getTime(), aEnd.getTime(), bStart.getTime(), bEnd.getTime());
}

// ── Recurrence ───────────────────────────────────────────────────────────────
/**
 * Generate recurrence instances (Date pairs) up to recurrence_end (inclusive).
 * The safety counter caps expansion at 366 iterations so a far-future or malformed
 * end date can't spin into a runaway loop.
 */
export function expandRecurrence(
  start: Date,
  end: Date,
  recurrence: "none" | "weekly",
  recurrenceEnd: Date | null,
): { start: Date; end: Date }[] {
  if (recurrence === "none" || !recurrenceEnd) return [{ start, end }];
  const out: { start: Date; end: Date }[] = [];
  let s = start;
  let e = end;
  let safety = 0;
  while (s <= recurrenceEnd && safety < 366) {
    out.push({ start: s, end: e });
    s = addWeeks(s, 1);
    e = addWeeks(e, 1);
    safety++;
  }
  return out;
}

export function combineDateTime(dateStr: string, timeStr: string): Date {
  // dateStr: yyyy-MM-dd, timeStr: HH:mm
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mn] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, h, mn, 0, 0);
}

/**
 * Re-apply the earliest-slot floor to a chosen start time.
 *
 * The floor has to be an INVARIANT, not a selection-time filter. The time wheel
 * clamps inside its own commit(), which runs only while the user is spinning it —
 * so choosing a later date, picking an early time, then switching back to today
 * left a past time selected and the form quietly unsubmittable.
 *
 * "HH:mm" compares lexicographically = chronologically, so plain string compare is
 * correct here. Returns the floor when `date` IS the earliest bookable day and the
 * time falls below it; otherwise returns `startTime` untouched.
 */
export function clampStartToFloor(
  startTime: string,
  date: string,
  earliestDay: string,
  earliestTime: string,
): string {
  if (!startTime || date !== earliestDay) return startTime;
  return startTime < earliestTime ? earliestTime : startTime;
}

export function addHours(d: Date, h: number) {
  return addMinutes(d, h * 60);
}

// Round a Date UP to the next 15-minute boundary (seconds/millis dropped). An
// already-aligned time is returned unchanged. The single grid the time picker and
// the "next available slot" default both snap to.
export function snapUpTo15(input: Date): Date {
  const d = new Date(input);
  d.setSeconds(0, 0);
  const remainder = d.getMinutes() % 15;
  if (remainder !== 0) d.setMinutes(d.getMinutes() + (15 - remainder));
  return d;
}

// Earliest 15-min-aligned start (from `now`) whose [start, start+durationMs) window
// clears every given booking — the honest default for a fresh booking so the form
// never seeds a slot that already clashes. Jumps past a conflict to its end (snapped
// up) instead of crawling 15 min at a time; caps the search at `horizonDays` and
// falls back to the first boundary so it always returns something. `bookings` is the
// best-effort visible-window set — the submit RPC's overlap guard stays authoritative.
export function nextAvailableSlot(
  now: Date,
  bookings: Pick<Booking, "start_time" | "end_time">[],
  durationMs: number,
  opts: { horizonDays?: number } = {},
): Date {
  const horizonDays = opts.horizonDays ?? 14;
  const first = snapUpTo15(now);
  const limit = now.getTime() + horizonDays * 86_400_000;
  let start = first;
  let safety = 0;
  while (start.getTime() <= limit && safety < 2000) {
    const end = new Date(start.getTime() + durationMs);
    const clash = bookings.find((b) => overlaps(start, end, new Date(b.start_time), new Date(b.end_time)));
    if (!clash) return start;
    const jumped = snapUpTo15(new Date(clash.end_time));
    start = jumped.getTime() > start.getTime() ? jumped : new Date(start.getTime() + 15 * 60_000);
    safety++;
  }
  return first;
}
