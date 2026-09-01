// ── CalendarPanel ────────────────────────────────────────────────────────────
// The single-date month calendar, extracted from DateField so ONE implementation
// serves both hosts: the legacy inline panel (DateField, still used by EventForm)
// and the Form System's PickerDropdown (which passes `compact`).
//
// Purely presentational: emits a "yyyy-MM-dd" string through onChange, so the
// storage path (combineDateTime → toISOString → bookings) is byte-for-byte unchanged.
import { useState } from "react";
import { format, isSameDay } from "date-fns";

import { DayGrid } from "@/components/DayGrid";
import { MonthNavHeader } from "@/components/MonthNavHeader";
import { useMonthGrid } from "@/hooks/useMonthGrid";
import { useI18n } from "@/hooks/useI18n";
import { getDateLocale } from "@/lib/date";
import { cn } from "@/lib/utils";

const KEY = "yyyy-MM-dd";

const parseDay = (value: string): Date | null => {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

interface Props {
  value: string; // "yyyy-MM-dd" ("" = none)
  onChange: (value: string) => void;
  /** Earliest selectable date "yyyy-MM-dd"; earlier days are disabled. */
  min?: string;
  /**
   * Latest selectable date "yyyy-MM-dd"; later days are disabled and the month nav
   * stops. Mirrors `min` so a caller can pin the calendar to what the SERVER will
   * actually accept — the picker must never offer a date the submit would reject.
   */
  max?: string;
  /**
   * Days whose slot already clashes with an approved booking. Marked struck-through
   * and unselectable — the SAME language MonthDatePicker uses for pick-dates, so
   * both calendars read identically.
   */
  isUnavailable?: (dayKey: string) => boolean;
  /** Fired when the visible month changes (for callers that fetch per month). */
  onMonthChange?: (monthStart: Date) => void;
  /** Tighter rows so a dropdown fits without scrolling. */
  compact?: boolean;
  /**
   * Host action (Done) placed on the month-nav row. When present, picking a day
   * does NOT dismiss — Done does — matching the multi-date picker.
   */
  headerTrailing?: React.ReactNode;
  className?: string;
}

export function CalendarPanel({ value, onChange, min, max, isUnavailable, onMonthChange, compact = false, headerTrailing, className }: Props) {
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);
  const selected = parseDay(value);
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => selected ?? new Date());

  const { gridDays, weekdayLabels } = useMonthGrid(monthAnchor, dateLocale);

  const anchorMonthKey = format(monthAnchor, "yyyy-MM");
  const minMonthKey = min ? min.slice(0, 7) : null;
  const maxMonthKey = max ? max.slice(0, 7) : null;
  const canGoPrev = !minMonthKey || anchorMonthKey > minMonthKey;
  const canGoNext = !maxMonthKey || anchorMonthKey < maxMonthKey;

  const changeMonth = (next: Date) => {
    setMonthAnchor(next);
    onMonthChange?.(next);
  };

  return (
    <div className={cn(compact ? "space-y-1.5" : "space-y-2", className)}>
      <MonthNavHeader monthAnchor={monthAnchor} onMonthChange={changeMonth} canGoPrev={canGoPrev} canGoNext={canGoNext} compact={compact} trailing={headerTrailing} />
      <DayGrid
        compact={compact}
        days={gridDays}
        weekdayLabels={weekdayLabels}
        monthAnchor={monthAnchor}
        isSelected={(day) => !!selected && isSameDay(day, selected)}
        isDisabled={(day) => {
          const key = format(day, KEY);
          if (min && key < min) return true;
          if (max && key > max) return true;
          // The currently-selected day stays selectable so a booking being edited
          // never disables its own date.
          if (selected && isSameDay(day, selected)) return false;
          return !!isUnavailable?.(key);
        }}
        onSelect={(day) => onChange(format(day, KEY))}
        dayLabel={(day, state) => {
          const key = format(day, KEY);
          const label = format(day, "EEEE, MMMM d", { locale: dateLocale });
          // Out-of-range days are disabled for a different reason than "already
          // booked", so they must not get the struck-through unavailable treatment.
          const inRange = (!min || key >= min) && (!max || key <= max);
          const unavailable = !state.selected && inRange && !!isUnavailable?.(key);
          return unavailable ? `${label} — ${t("bookingForm.dateUnavailable")}` : label;
        }}
        dayClassName={(day, state) => {
          const key = format(day, KEY);
          // Out-of-range days are disabled for a different reason than "already
          // booked", so they must not get the struck-through unavailable treatment.
          const inRange = (!min || key >= min) && (!max || key <= max);
          const unavailable = !state.selected && inRange && !!isUnavailable?.(key);
          return unavailable ? "line-through decoration-muted-foreground/50" : undefined;
        }}
      />
    </div>
  );
}

export default CalendarPanel;
