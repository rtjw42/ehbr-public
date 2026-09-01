// ── Month-grid multi-date picker ─────────────────────────────────────────────
// Pick-dates booking mode: tap days in a month grid to toggle them, up to `max`.
// Grid only — the count and the removable chips live BESIDE the field in the form,
// because inside a dropdown they are the one unbounded element (up to `max` chips
// over several rows) and that growth is what forced the panel to scroll.
// Pure & controlled — no Supabase, no new dependency (built on date-fns + tokens),
// so it code-splits cleanly behind the booking form's lazy boundary. Mobile-first:
// min-h-11 tap targets, an inline panel (never a bottom sheet).
import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";
import { DayGrid } from "@/components/DayGrid";
import { MonthNavHeader } from "@/components/MonthNavHeader";
import { useMonthGrid } from "@/hooks/useMonthGrid";
import { useI18n } from "@/hooks/useI18n";
import { getDateLocale } from "@/lib/date";

interface Props {
  /** Selected dates as yyyy-MM-dd (order-independent; chips render sorted). */
  selected: string[];
  /** Toggle a date on/off (yyyy-MM-dd). Removing a selected date also uses this. */
  onToggle: (date: string) => void;
  /** Max selectable dates; unselected days disable once the cap is reached. */
  max: number;
  /** True when the shared time on this date overlaps an approved booking. */
  isUnavailable: (date: string) => boolean;
  /** Earliest selectable date as yyyy-MM-dd (today); earlier days are disabled. */
  minDate: string;
  /** Latest selectable date as yyyy-MM-dd; later days are disabled and nav stops. */
  maxDate?: string;
  /**
   * Fires with the visible month's start on mount and whenever the user navigates,
   * so the owner can fetch that month's approved bookings for availability.
   */
  onMonthChange?: (monthStart: Date) => void;
  /** Tighter rows so a dropdown fits without scrolling. */
  compact?: boolean;
  /** Host action (e.g. Done) placed on the month-nav row rather than its own. */
  headerTrailing?: React.ReactNode;
}

const DATE_KEY = "yyyy-MM-dd";

export const MonthDatePicker = ({ selected, onToggle, max, isUnavailable, minDate, maxDate, onMonthChange, compact = false, headerTrailing }: Props) => {
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const atCap = selected.length >= max;

  // Anchor the visible month; start on the first selected date's month, else today.
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => {
    const first = [...selected].sort()[0];
    return first ? new Date(`${first}T00:00:00`) : new Date();
  });

  const minMonthKey = minDate.slice(0, 7); // yyyy-MM
  const maxMonthKey = maxDate ? maxDate.slice(0, 7) : null;
  const anchorMonthKey = format(monthAnchor, "yyyy-MM");
  const canGoPrev = anchorMonthKey > minMonthKey;
  const canGoNext = !maxMonthKey || anchorMonthKey < maxMonthKey;

  // Let the form fetch this month's approved bookings so availability isn't limited
  // to whatever window the page happened to load. monthAnchor only changes via the
  // nav buttons, so this fires once on mount + once per month navigation.
  useEffect(() => {
    onMonthChange?.(startOfMonth(monthAnchor));
  }, [monthAnchor, onMonthChange]);

  // Weekday headers + the padded 6-week grid come from the shared hook, so this and
  // DateField's calendar can never drift (Sunday-first lives in exactly one place).
  const { gridDays, weekdayLabels } = useMonthGrid(monthAnchor, dateLocale);

  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"}>
      {/* Month nav — shared with DateField's calendar. */}
      <MonthNavHeader monthAnchor={monthAnchor} onMonthChange={setMonthAnchor} canGoPrev={canGoPrev} canGoNext={canGoNext} compact={compact} trailing={headerTrailing} />

      {/* Accessible grid — shared with DateField's calendar. A selected day stays enabled
          (to allow deselect) even if unavailable; only unselected past/unavailable/at-cap
          days disable. */}
      <DayGrid
        compact={compact}
        days={gridDays}
        weekdayLabels={weekdayLabels}
        monthAnchor={monthAnchor}
        isSelected={(day) => selectedSet.has(format(day, DATE_KEY))}
        isDisabled={(day) => {
          const key = format(day, DATE_KEY);
          if (selectedSet.has(key)) return false;
          if (maxDate && key > maxDate) return true;
          return key < minDate || isUnavailable(key) || atCap;
        }}
        onSelect={(day) => onToggle(format(day, DATE_KEY))}
        dayLabel={(day, state) => {
          const label = format(day, "EEEE, MMMM d", { locale: dateLocale });
          const key = format(day, DATE_KEY);
          const unavailable =
            !state.selected && key >= minDate && (!maxDate || key <= maxDate) && isUnavailable(key);
          return unavailable ? `${label} — ${t("bookingForm.dateUnavailable")}` : label;
        }}
        dayClassName={(day, state) => {
          const key = format(day, DATE_KEY);
          const unavailable =
            !state.selected && key >= minDate && (!maxDate || key <= maxDate) && isUnavailable(key);
          return unavailable ? "line-through decoration-muted-foreground/50" : undefined;
        }}
      />

    </div>
  );
};

export default MonthDatePicker;
