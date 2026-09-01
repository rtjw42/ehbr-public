import { useMemo } from "react";
import { addDays, format, startOfMonth, startOfWeek } from "date-fns";
import type { getDateLocale } from "@/lib/date";

// ── Month grid ───────────────────────────────────────────────────────────────
// The single source for BOTH calendars (DateField's single-date picker and
// MonthDatePicker's pick-dates grid): a 6-week day list and the weekday header
// labels. They used to compute this independently, which meant the Sunday-first
// switch had to be made twice — exactly the drift this prevents.
//
// Sunday-first is a display preference only. It is deliberately NOT tied to the app's
// Mon–Sun booking-week logic (getWeekDays / the SGT Telegram board in booking-utils):
// those define which days belong to a "week", not how a picker is laid out.
const WEEK_STARTS_ON = 0 as const;

export function useMonthGrid(monthAnchor: Date, dateLocale: ReturnType<typeof getDateLocale>) {
  // ALWAYS six weeks, even when the month spans four or five. A calendar that
  // changes height as you page between months makes its dropdown resize under the
  // user — and forces every panel that hosts it to re-measure. A fixed 42-day block
  // costs one extra row on most months and buys a completely predictable height.
  // Days outside the month are dimmed by DayGrid, so the padding reads as padding.
  const gridDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [monthAnchor]);

  const weekdayLabels = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 7 }, (_, i) => format(addDays(base, i), "EEEEE", { locale: dateLocale }));
  }, [dateLocale]);

  return { gridDays, weekdayLabels };
}
