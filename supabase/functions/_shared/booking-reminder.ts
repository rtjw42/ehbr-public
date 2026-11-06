// The safety-net reminder's rule, pure so it is tested without a database. Imported
// by telegram-reminder (Deno) and the Vitest suite (Node), so it stays free of Deno
// globals and npm imports.
//
// Once a day at 10:00 SGT, remind about each pending request whose first session is
// 24–48h away and that was made at least 48h ahead of it. The window is as long as
// the gap between runs, so a request matches exactly one run and nothing has to
// remember what was already sent.

import type { TelegramBookingRow, TelegramRecurrence } from "./telegram-format.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// 10:00 SGT is 02:00 UTC. Keep in step with the `telegram-booking-reminder` cron.
const RUN_OFFSET_MS = 2 * HOUR_MS;
const MIN_NOTICE_MS = 48 * HOUR_MS;

export type PendingBookingRow = TelegramBookingRow & {
  id: string;
  group_id: string | null;
  title: string;
  name: string;
  created_at: string;
  booking_groups: { recurrence: string | null } | null;
};

export type PendingRequest = {
  title: string;
  name: string;
  recurrence: TelegramRecurrence;
  rows: TelegramBookingRow[];
  requestedAt: string;
};

const ms = (iso: string) => new Date(iso).getTime();
const earliest = (values: string[]) => values.reduce((a, b) => (ms(b) < ms(a) ? b : a));

// One entry per request, matching how an admin reads the queue: a grouped request
// counts once, singles count once each.
export const groupPendingRequests = (rows: PendingBookingRow[]): PendingRequest[] => {
  const byRequest = new Map<string, PendingBookingRow[]>();
  for (const row of rows) {
    const key = row.group_id ?? row.id;
    (byRequest.get(key) ?? byRequest.set(key, []).get(key)!).push(row);
  }
  return [...byRequest.values()].map((sessions) => ({
    title: sessions[0].title,
    name: sessions[0].name,
    recurrence: sessions[0].booking_groups?.recurrence === "weekly" ? "weekly" : "none",
    rows: sessions.map(({ start_time, end_time }) => ({ start_time, end_time })),
    requestedAt: earliest(sessions.map((session) => session.created_at)),
  }));
};

// The window hangs off the scheduled 10:00, not the clock, because cron fires a few
// seconds late by a varying amount: measured from `now`, a session exactly two days
// out could fall between two runs and never match.
const scheduledRun = (now: Date) =>
  Math.floor((now.getTime() - RUN_OFFSET_MS) / DAY_MS) * DAY_MS + RUN_OFFSET_MS;

export const requestsToRemind = (requests: PendingRequest[], now: Date) => {
  const run = scheduledRun(now);
  return requests.filter((request) => {
    const firstSession = ms(earliest(request.rows.map((row) => row.start_time)));
    return (
      firstSession >= run + DAY_MS &&
      firstSession < run + 2 * DAY_MS &&
      firstSession - ms(request.requestedAt) >= MIN_NOTICE_MS
    );
  });
};
