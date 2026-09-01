// ── Accessible day grid ──────────────────────────────────────────────────────
// Shared by BOTH calendars (DateField's single-date picker and MonthDatePicker's
// pick-dates grid). Restores the accessibility the native <input type="date"> gave for
// free and that our first custom calendars dropped: a real `role="grid"` with roving
// tabindex (one tab stop, not 42) and arrow / Home / End keyboard navigation.
//
// Selection model is injected (isSelected/isDisabled/onSelect), so single-select and
// multi-select share the exact same keyboard + ARIA behaviour and can't drift.
import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, format, isSameDay, isSameMonth } from "date-fns";
import { cn } from "@/lib/utils";

const KEY = "yyyy-MM-dd";

export interface DayState {
  selected: boolean;
  disabled: boolean;
  inMonth: boolean;
  today: boolean;
}

interface Props {
  /** The padded 6-week day list from useMonthGrid. */
  days: Date[];
  weekdayLabels: string[];
  monthAnchor: Date;
  isSelected: (day: Date) => boolean;
  isDisabled: (day: Date) => boolean;
  onSelect: (day: Date) => void;
  /** Accessible label per cell (e.g. append "unavailable"). */
  dayLabel: (day: Date, state: DayState) => string;
  /** Extra per-cell classes (e.g. strike-through for unavailable). */
  dayClassName?: (day: Date, state: DayState) => string | undefined;
  /** Tighter rows for a picker dropdown, which must fit without scrolling. */
  compact?: boolean;
}

export function DayGrid({
  days,
  weekdayLabels,
  monthAnchor,
  isSelected,
  isDisabled,
  onSelect,
  dayLabel,
  dayClassName,
  compact = false,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const today = new Date();

  // The single roving tab stop: prefer the selected day, else today, else first
  // selectable day. A disabled day is never the tab stop (it can't be focused).
  const pickInitial = useCallback(() => {
    const enabled = days.filter((d) => !isDisabled(d));
    const sel = enabled.find((d) => isSelected(d));
    if (sel) return format(sel, KEY);
    const td = enabled.find((d) => isSameDay(d, today));
    if (td) return format(td, KEY);
    return format(enabled[0] ?? days[0], KEY);
    // today is a fresh Date each render but only its calendar-day matters; deps below
    // intentionally exclude it to avoid churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, isDisabled, isSelected]);

  const [focusKey, setFocusKey] = useState(pickInitial);

  // When the month changes, the old focusKey falls outside the grid — no cell would be
  // tabbable and Tab couldn't enter the calendar. Re-seed it.
  useEffect(() => {
    if (!days.some((d) => format(d, KEY) === focusKey)) setFocusKey(pickInitial());
  }, [days, focusKey, pickInitial]);

  const focusDay = useCallback((day: Date) => {
    const key = format(day, KEY);
    setFocusKey(key);
    gridRef.current?.querySelector<HTMLElement>(`[data-daykey="${key}"]`)?.focus();
  }, []);

  // Step in the arrow's direction, skipping disabled days, staying inside the grid.
  const step = useCallback(
    (from: Date, delta: number) => {
      const first = days[0].getTime();
      const last = days[days.length - 1].getTime();
      const dir = delta > 0 ? 1 : -1;
      let target = addDays(from, delta);
      while (target.getTime() >= first && target.getTime() <= last) {
        if (!isDisabled(target)) return target;
        target = addDays(target, dir);
      }
      return null;
    },
    [days, isDisabled],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const from = new Date(`${focusKey}T00:00:00`);
    if (e.key in deltas) {
      e.preventDefault();
      const next = step(from, deltas[e.key]);
      if (next) focusDay(next);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const idx = days.findIndex((d) => format(d, KEY) === focusKey);
      if (idx < 0) return;
      const rowStart = idx - (idx % 7);
      const dir = e.key === "Home" ? 1 : -1;
      const from2 = e.key === "Home" ? rowStart : rowStart + 6;
      for (let i = from2; i >= rowStart && i <= rowStart + 6; i += dir) {
        if (!isDisabled(days[i])) {
          focusDay(days[i]);
          break;
        }
      }
    }
  };

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div role="grid" ref={gridRef} onKeyDown={onKeyDown} className={compact ? "space-y-0.5" : "space-y-1"}>
      <div role="row" className={cn("grid grid-cols-7", compact ? "gap-0.5" : "gap-1")}>
        {weekdayLabels.map((label, i) => (
          <div key={i} role="columnheader" className={cn("text-center type-badge uppercase tracking-wide text-muted-foreground", compact ? "py-0" : "py-1")}>
            {label}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div role="row" key={wi} className={cn("grid grid-cols-7", compact ? "gap-0.5" : "gap-1")}>
          {week.map((day) => {
            const key = format(day, KEY);
            const state: DayState = {
              selected: isSelected(day),
              disabled: isDisabled(day),
              inMonth: isSameMonth(day, monthAnchor),
              today: isSameDay(day, today),
            };
            return (
              <div role="gridcell" key={key} aria-selected={state.selected} className="contents">
                <button
                  type="button"
                  data-daykey={key}
                  tabIndex={key === focusKey ? 0 : -1}
                  disabled={state.disabled}
                  aria-label={dayLabel(day, state)}
                  aria-current={state.today ? "date" : undefined}
                  onClick={() => !state.disabled && onSelect(day)}
                  onFocus={() => setFocusKey(key)}
                  className={cn(
                    "relative flex w-full items-center justify-center rounded-md tabular-nums outline-none transition-colors duration-fast",
                    compact ? "min-h-9 text-[0.8125rem]" : "min-h-11 text-sm",
                    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/50",
                    !state.inMonth && "opacity-40",
                    state.selected
                      ? "bg-[var(--interactive-bg)] font-semibold text-[var(--interactive-text)]"
                      : state.disabled
                        ? "text-muted-foreground/40"
                        : "text-foreground hover:bg-muted active:scale-[0.97] active:duration-tap",
                    state.today && !state.selected && "ring-1 ring-inset ring-foreground/30",
                    dayClassName?.(day, state),
                  )}
                >
                  {format(day, "d")}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default DayGrid;
