// Pure, dependency-free Telegram message builders. Imported by both the Edge
// Functions (Deno) and the Vitest suite (Node), so this file must stay free of
// Deno globals, browser APIs, and npm imports. No emojis anywhere.
//
// Escaping contract (owner-approved 2026-07-06, supersedes the original
// plain-text-only decision):
//   • BOTH builders emit HTML and MUST be sent with parse_mode:"HTML". Every
//     user-supplied value they interpolate (title / name / info, and the review
//     + calendar URLs, whose query strings contain `&`) goes through escapeHtml,
//     so a `<` or `&` is displayed literally, never parsed as markup.
//   • buildWeeklyBoardMessage additionally uses HTML entities of its own for the
//     bold day headers and the tappable calendar link — it is NOT plain text.
// Escaping stops MARKUP injection, not link SPAM: Telegram still auto-linkifies
// bare URLs / @mentions in displayed text, so those are rejected upstream at the
// submit boundary (see supabase/functions/_shared/text-guard.ts), not here.

const TIME_ZONE = "Asia/Singapore";

export type TelegramBookingRow = {
  start_time: string;
  end_time: string;
};

// Weekly is the only pattern ("daily"/"monthly" retired — multi-date pick covers
// them); submit-booking narrows anything else to "none".
export type TelegramRecurrence = "none" | "weekly";

// Escape the five HTML-significant chars so user-supplied text (title / name /
// info) is inert under parse_mode="HTML". The admin message uses HTML entities
// for bold labels + a blue "Approve / Reject" link; every interpolated value —
// including the review URL, whose query string contains `&` — must pass through
// this, or Telegram will reject the message (or worse, render injected markup).
export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export type TelegramBoardRow = TelegramBookingRow & {
  title: string;
  name: string;
};

// ── SGT calendar parts ────────────────────────────────────────────────────────

const sgtFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

type SgtParts = {
  year: number;
  monthShort: string;
  day: number;
  weekdayShort: string;
  hour: number;
  minute: number;
};

// Full weekday name in SGT ("Wednesday"), for the "Every <day>" weekly line.
const sgtWeekdayLongFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "long",
});
const sgtWeekdayLong = (iso: string) => sgtWeekdayLongFormatter.format(new Date(iso));

const sgtParts = (value: string | Date): SgtParts => {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts: Record<string, string> = {};
  for (const part of sgtFormatter.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    monthShort: parts.month,
    day: Number(parts.day),
    weekdayShort: parts.weekday,
    // hour12:false can render midnight as "24" in some ICU builds.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
};

// ── Times: 12h compact, exact minutes (7pm, 2:30pm, 7:24pm) ──────────────────

const meridiem = (hour: number) => (hour < 12 ? "am" : "pm");

// The bare clock, no am/pm ("7", "2:30", "12").
const clockCore = ({ hour, minute }: Pick<SgtParts, "hour" | "minute">) => {
  const clockHour = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${clockHour}` : `${clockHour}:${String(minute).padStart(2, "0")}`;
};

const formatCompactTime = (parts: Pick<SgtParts, "hour" | "minute">) =>
  `${clockCore(parts)}${meridiem(parts.hour)}`;

// Compact range: when both ends share am/pm, the start drops its suffix
// (7–9pm, 2:30–4pm); when they differ, both keep it (11am–1pm).
export const formatTelegramTimeRange = (startIso: string, endIso: string) => {
  const start = sgtParts(startIso);
  const end = sgtParts(endIso);
  const endStr = formatCompactTime(end);
  return meridiem(start.hour) === meridiem(end.hour)
    ? `${clockCore(start)}–${endStr}`
    : `${formatCompactTime(start)}–${endStr}`;
};

// ── Multi-day span (one booking that crosses SGT midnight) ───────────────────
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Singapore is a fixed UTC+8, no DST
const DAY_MS = 24 * 60 * 60 * 1000;

// SGT calendar-day index (days since epoch, shifted to SGT). A booking occupies
// [start, end), so callers pass endMs-1 for the last occupied day — a booking
// ending exactly at midnight then counts as the previous day, not a new one.
const sgtDayIndex = (ms: number) => Math.floor((ms + SGT_OFFSET_MS) / DAY_MS);

export const isMultiDaySgt = (startIso: string, endIso: string) =>
  sgtDayIndex(new Date(startIso).getTime()) !== sgtDayIndex(new Date(endIso).getTime() - 1);

// "6 Jul 3am" — SGT date + compact time.
const formatSgtDateTime = (iso: string) => {
  const parts = sgtParts(iso);
  return `${parts.day} ${parts.monthShort} ${formatCompactTime(parts)}`;
};

// "6 Jul 3am → 8 Jul 5am" for a booking that crosses midnight.
export const formatMultiDaySpan = (startIso: string, endIso: string) =>
  `${formatSgtDateTime(startIso)} → ${formatSgtDateTime(endIso)}`;

// ── Dates: "14 Jun" / "14, 16, 19 Jun" / "30 Jun, 2, 4 Jul" ─────────────────

const sortRows = <T extends TelegramBookingRow>(rows: T[]) =>
  [...rows].sort((a, b) => a.start_time.localeCompare(b.start_time));

const formatDateList = (rows: TelegramBookingRow[]) => {
  const groups: { key: string; monthShort: string; days: number[] }[] = [];
  for (const row of sortRows(rows)) {
    const { year, monthShort, day } = sgtParts(row.start_time);
    const key = `${monthShort} ${year}`;
    const group = groups[groups.length - 1];
    if (group && group.key === key) group.days.push(day);
    else groups.push({ key, monthShort, days: [day] });
  }
  return groups.map((group) => `${group.days.join(", ")} ${group.monthShort}`).join(", ");
};

// ── Shared HTML chrome ───────────────────────────────────────────────────────

const INFO_MAX_CHARS = 140;

// Band-room branding: instrument emoji flank the board title (not per-booking —
// we don't store which instrument a slot is for). The pen marks the admin ping.
// All are plain unicode (no custom-emoji entitlement needed).
const GUITAR = "🎸";
const DRUM = "🥁";
const PEN = "🖊️";
const CALENDAR = "📅";

// The admin-ping header text + a continuous box-drawing rule (U+2500 has no
// inter-glyph gap like hyphens do) sized to the header's length, so the top
// divider roughly matches the title width. Used only on the admin ping, so
// stacked request messages read as visually separate bubbles.
const REQUEST_HEADER = "New booking request";
const BOX_RULE = "─".repeat(REQUEST_HEADER.length);

// "15 Jun" for one row (SGT calendar day).
const formatSingleDate = (row: TelegramBookingRow) => {
  const { day, monthShort } = sgtParts(row.start_time);
  return `${day} ${monthShort}`;
};

// ── C1: admin-chat new-request message (HTML parse_mode) ─────────────────────
// A notification: a top rule (so stacked requests read as separate bubbles), a
// pen-marked header, bold session title, one "who · when · time" facts line
// (case-dependent), the freeform note as an italic line, and an action link with
// the live pending count. Every user field passes through escapeHtml.

export const buildAdminRequestMessage = (input: {
  title: string;
  name: string;
  info: string;
  recurrence: TelegramRecurrence;
  rows: TelegramBookingRow[];
  reviewUrl: string;
  // Total requests now awaiting approval (this new one included). Omitted →
  // the count is left off (e.g. if the count query failed).
  pendingCount?: number;
}) => {
  const rows = sortRows(input.rows);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const name = escapeHtml(input.name);
  const time = () => formatTelegramTimeRange(first.start_time, first.end_time);

  const lines = [BOX_RULE, `${PEN} <b>${REQUEST_HEADER}</b>`, "", `<b>${escapeHtml(input.title)}</b>`];

  // Mirrors the website's date-then-time hierarchy, collapsed onto a facts line.
  if (rows.length === 1 && isMultiDaySgt(first.start_time, first.end_time)) {
    // A single booking that crosses midnight → one span, no separate date/time.
    lines.push(`${name} · <b>${formatMultiDaySpan(first.start_time, first.end_time)}</b>`);
  } else if (input.recurrence !== "none") {
    // Weekly pattern → weekday + time, then the run as a second line.
    lines.push(`${name} · <b>Every ${sgtWeekdayLong(first.start_time)}</b> · <b>${time()}</b>`);
    lines.push(`${formatSingleDate(first)} – ${formatSingleDate(last)} · ${rows.length} sessions`);
  } else if (rows.length === 1) {
    lines.push(`${name} · <b>${formatSingleDate(first)}</b> · <b>${time()}</b>`);
  } else {
    // Pick-dates: time, then the full list of hand-picked days as a second line.
    lines.push(`${name} · <b>${time()}</b>`);
    lines.push(`${escapeHtml(formatDateList(rows))} · ${rows.length} dates`);
  }

  const info = input.info.trim();
  if (info) {
    const truncated = info.length > INFO_MAX_CHARS ? `${info.slice(0, INFO_MAX_CHARS).trimEnd()}…` : info;
    lines.push(`<i>${escapeHtml(truncated)}</i>`);
  }

  const action = `<a href="${escapeHtml(input.reviewUrl)}">Approve / Reject</a>`;
  lines.push("", typeof input.pendingCount === "number" ? `${action} · ${input.pendingCount} pending` : action);
  return lines.join("\n");
};

// ── C2: SGT ISO week window (Mon 00:00 → next Mon 00:00) ─────────────────────
// SGT is fixed UTC+8 with no DST, so the window can be computed by epoch shift
// (SGT_OFFSET_MS / DAY_MS are defined up top with the multi-day helpers).
// Week authority (server): this is the canonical Mon–Sun window, hardcoded to SGT
// because Edge runs with an unknown server timezone. The client mirror is
// `weekRange`/`getWeekDays` in src/lib/booking-utils.ts (device-local, == SGT for
// the band's users). Keep the two in step — same Mon–Sun rule, two runtimes.

export const sgtWeekWindow = (now: Date) => {
  const shifted = new Date(now.getTime() + SGT_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const mondayEpoch =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysSinceMonday) -
    SGT_OFFSET_MS;
  return { start: new Date(mondayEpoch), end: new Date(mondayEpoch + 7 * DAY_MS) };
};

// The board previews the UPCOMING week a little early — from Sunday 19:00 SGT
// (5h before Monday) it rolls to next week's Mon–Sun so the band sees what's
// booked before the week starts. Board-only; the website calendar keeps showing
// the true current week (weekRange in booking-utils). Keep this lead in step with
// the Sunday rollover cron (Sun 19:00 SGT = Sun 11:00 UTC).
export const BOARD_WEEK_LEAD_MS = 5 * 60 * 60 * 1000;

export const sgtBoardWeekWindow = (now: Date) =>
  sgtWeekWindow(new Date(now.getTime() + BOARD_WEEK_LEAD_MS));

// Sent once as its own message, right before the fresh board on the Sunday
// rollover (a real ping). Not tracked or edited — it just sits in history above
// each week's board.
export const NEXT_WEEK_ANNOUNCEMENT = `${CALENDAR} <b>Next week's bookings!</b>`;

// ── C2: band-chat weekly board (HTML parse_mode) ─────────────────────────────
// Emoji-flanked title carrying the week range, one bold-headed block per occupied
// day (blocks separated by a blank line), a tappable calendar link, and an italic
// "Updated" stamp. A booking that crosses SGT midnight is split per day, each day
// showing only its own slice of the time (10pm–12am, then 12–5am) with a "(cont.)"
// suffix on the continued days, and "Whole day" for any day it fills wall-to-wall
// — so a glance at any weekday shows the room's real occupancy. Never includes the
// freeform `info` field (PII scope:
// names only, same as the public calendar). Every user field passes escapeHtml.
// Callers pass approved rows already filtered to the window + the calendar URL.

export const buildWeeklyBoardMessage = (input: {
  now: Date;
  rows: TelegramBoardRow[];
  bookingUrl: string;
}) => {
  const { start, end } = sgtBoardWeekWindow(input.now);
  const startParts = sgtParts(start);
  const endParts = sgtParts(new Date(end.getTime() - DAY_MS)); // inclusive Sunday
  const range =
    startParts.monthShort === endParts.monthShort && startParts.year === endParts.year
      ? `${startParts.day}–${endParts.day} ${endParts.monthShort}`
      : `${startParts.day} ${startParts.monthShort}–${endParts.day} ${endParts.monthShort}`;

  const rows = sortRows(input.rows);
  let body: string;
  if (rows.length === 0) {
    body = "No bookings this week.";
  } else {
    const windowStartIdx = sgtDayIndex(start.getTime());
    const windowEndIdx = sgtDayIndex(end.getTime() - 1);
    const dayMidnightEpoch = (dayIdx: number) => dayIdx * DAY_MS - SGT_OFFSET_MS;

    const byDay = new Map<number, { sortKey: number; text: string }[]>();
    for (const row of rows) {
      const startMs = new Date(row.start_time).getTime();
      const endMs = new Date(row.end_time).getTime();
      // endMs-1 so a booking ending exactly at midnight counts the previous day
      // as its last, not a new empty one.
      const firstDay = sgtDayIndex(startMs);
      const lastDay = sgtDayIndex(endMs - 1);
      const label = `${escapeHtml(row.title)} · ${escapeHtml(row.name)}`;
      for (let d = Math.max(firstDay, windowStartIdx); d <= Math.min(lastDay, windowEndIdx); d++) {
        const dayStartMs = dayMidnightEpoch(d);
        const dayEndMs = dayMidnightEpoch(d + 1);
        // Clip the booking to this SGT day → only its own slice of time shows. A
        // day the booking fills wall-to-wall (mid-run of a multi-day booking)
        // reads "Whole day"; every day after the first carries a "(cont.)" suffix
        // so a long booking reads as one continued run, not separate slots.
        const segStartMs = Math.max(startMs, dayStartMs);
        const segEndMs = Math.min(endMs, dayEndMs);
        const timeToken =
          segStartMs === dayStartMs && segEndMs === dayEndMs
            ? "Whole day"
            : formatTelegramTimeRange(new Date(segStartMs).toISOString(), new Date(segEndMs).toISOString());
        const suffix = d === firstDay ? "" : " (cont.)";
        const text = `   <b>${timeToken}</b> · ${label}${suffix}`;
        (byDay.get(d) ?? byDay.set(d, []).get(d)!).push({ sortKey: segStartMs, text });
      }
    }

    const dayBlocks: string[] = [];
    for (let d = windowStartIdx; d <= windowEndIdx; d++) {
      const entries = byDay.get(d);
      if (!entries) continue;
      entries.sort((a, b) => a.sortKey - b.sortKey);
      const h = sgtParts(new Date(dayMidnightEpoch(d) + 12 * 60 * 60 * 1000));
      dayBlocks.push([`<b>${h.weekdayShort} ${h.day} ${h.monthShort}</b>`, ...entries.map((e) => e.text)].join("\n"));
    }
    body = dayBlocks.join("\n\n"); // blank line between days
  }

  const nowParts = sgtParts(input.now);
  return [
    `${GUITAR} <b>Band room — ${range}</b> ${DRUM}`,
    "",
    body,
    "",
    `<a href="${escapeHtml(input.bookingUrl)}">${CALENDAR} Open the booking calendar</a>`,
    "",
    `<i>Updated ${nowParts.weekdayShort}, ${nowParts.day} ${nowParts.monthShort}, ${formatCompactTime(nowParts)}</i>`,
  ].join("\n");
};
