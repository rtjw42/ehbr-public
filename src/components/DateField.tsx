// ── Date field (inline styled calendar) ──────────────────────────────────────
// Replaces native <input type="date"> for the booking form. The native calendar popup
// can't be styled (browser-drawn); this swaps it for an app-styled month grid that
// expands INLINE under the field — the reliable pattern in a modal (a floating popover
// is frozen by the modal or clipped by its scroll). Mirrors MonthDatePicker's look so
// the single-date and pick-dates calendars read identically.
//
// Purely presentational: still emits a "yyyy-MM-dd" string through onChange, so the
// storage path (combineDateTime → toISOString → bookings) is byte-for-byte unchanged.
//
// ── Motion (Phase N — first FLIP consumer) ───────────────────────────────────
// The panel's height is NEVER animated. Owner's framing question was the whole
// design: "it's a separate part from the input field — can't it just appear?"
// Right — the panel never needed a height animation; the form BELOW it needed to
// not snap. So:
//
//   • The panel is position:absolute at `top: 100%` of the field — out of flow,
//     so mounting/unmounting it perturbs no layout at all. That is what makes a
//     delayed unmount safe here, unlike every previous attempt where the panel
//     was in flow and its unmount WAS the layout change.
//   • A SPACER div below the field carries the entire layout change: its height
//     goes 0 ↔ H instantly, never tweened.
//   • <FlipScope> then animates the resulting displacement of everything else
//     with compositor transforms, and the panel content rides the same clock
//     (−H → 0 opening, 0 → −H closing) so it fills exactly the space the
//     siblings vacate. They tile; nothing overlaps.
//
// Consequences worth knowing: nothing ABOVE the field ever moves, so the field
// stays under the user's thumb and there is no return-pan to write. And FLIP
// reads its `first` rects from current visual position, so an interrupted or
// handed-off run continues from where the eye is — which is why `withExit` /
// `exit={false}` registry coordination is gone rather than reimplemented.
import { forwardRef, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { format, isSameDay } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { DayGrid } from "@/components/DayGrid";
import { MonthNavHeader } from "@/components/MonthNavHeader";
import { useFlipPanel } from "@/hooks/useFlipPanel";
import { useMonthGrid } from "@/hooks/useMonthGrid";
import { useI18n } from "@/hooks/useI18n";
import { formatLocalizedDate, getDateLocale } from "@/lib/date";
import { openPicker, releasePicker } from "@/lib/picker-registry";
import { cn } from "@/lib/utils";

const KEY = "yyyy-MM-dd";
const parseDay = (value: string): Date | null => {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

interface Props {
  id?: string;
  value: string; // "yyyy-MM-dd" ("" = none)
  onChange: (value: string) => void;
  /** Earliest selectable date "yyyy-MM-dd"; earlier days are disabled. */
  min?: string;
  ariaInvalid?: boolean;
  /** Accessible name when no visible <label> is wired to this field (create-mode
      single date: the "Days" segmented header carries the visible label instead). */
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
}

export const DateField = forwardRef<HTMLButtonElement, Props>(
  ({ id, value, onChange, min, ariaInvalid, ariaLabel, className, placeholder }, ref) => {
    const { language, t } = useI18n();
    const dateLocale = getDateLocale(language);
    const [open, setOpen] = useState(false);
    const selected = parseDay(value);
    const [monthAnchor, setMonthAnchor] = useState<Date>(() => selected ?? new Date());
    // Panel mechanics (mount lifetime, spacer, FLIP, pan + its exact reverse)
    // all live in the shared recipe — see hooks/useFlipPanel.ts.
    const { mounted, rootRef, contentRef, clipRef, spacerRef, remeasure } = useFlipPanel(open);

    const closeSelf = useCallback(() => setOpen(false), []);
    // User-initiated close (picking a day / Escape). No return-pan: nothing above
    // the trigger moved, so there is nowhere to return to. preventScroll because
    // the browser's focus scroll would fight the FLIP.
    const closeAndFocus = useCallback(() => {
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }, [rootRef]);

    // Closes on picking a day, tapping the field again, or Escape — but NOT on an outside
    // tap, so a stray tap leaves it open. Opening another picker still dismisses this one
    // via the shared registry (one inline panel open at a time).
    useEffect(() => {
      if (open) openPicker(closeSelf);
      else releasePicker(closeSelf);
      return () => releasePicker(closeSelf);
    }, [open, closeSelf]);

    // A month change can swap a 5-week grid for a 6-week one. That is a real
    // geometry change and used to SNAP (the <Collapse> that replaced the old
    // <Resize dep={monthAnchor}> had no notion of it). Same FLIP, no special case.
    useLayoutEffect(remeasure, [monthAnchor, remeasure]);

    const label = selected
      ? formatLocalizedDate(selected, language, "d MMM yyyy", "yyyy 年 M 月 d 日")
      : placeholder ?? t("bookingForm.selectDate");

    const toggle = () => {
      // Re-anchor the grid on the selected month each time it opens.
      if (!open && selected) setMonthAnchor(selected);
      setOpen((o) => !o);
    };

    // LEGACY host (EventForm only). Here picking a day commits and closes; the Form
    // System's dropdown instead keeps the panel open and confirms with Done. Retire
    // this file with EventForm rather than reconciling the two.
    // (unlike the wheel, where spinning columns has no natural "finished" moment). There's
    // still no outside-tap close: a stray tap leaves the calendar open.
    const pick = (day: Date) => {
      onChange(format(day, KEY));
      closeAndFocus();
    };

    const { gridDays, weekdayLabels } = useMonthGrid(monthAnchor, dateLocale);

    const minMonthKey = min ? min.slice(0, 7) : null;
    const canGoPrev = !minMonthKey || format(monthAnchor, "yyyy-MM") > minMonthKey;

    return (
      <div
        ref={rootRef}
        // Escape collapses just the calendar and returns focus to the field. Handled at
        // the root (not the panel) so it also fires when focus is still on the trigger,
        // and stopPropagation keeps it from bubbling to the surrounding Radix Dialog and
        // closing the whole booking form. When closed, Escape passes through as normal.
        onKeyDown={(e) => {
          if (!open || e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          closeAndFocus();
        }}
        className={cn("min-w-0", className)}
      >
        <div className="relative">
          <button
            id={id}
            ref={ref}
            type="button"
            aria-invalid={ariaInvalid || undefined}
            aria-label={ariaLabel}
            aria-expanded={open}
            onClick={toggle}
            className={cn(
              "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-none transition-[border-color,box-shadow] [-webkit-tap-highlight-color:transparent]",
              // Keyboard-only focus cue (buttons aren't :focus-visible on mouse click), so
              // Tab shows a ring while a click just opens the calendar — no click outline.
              "focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]",
              "aria-[invalid=true]:border-destructive",
              open && "border-foreground/40",
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("truncate", selected ? "font-semibold tabular-nums" : "text-muted-foreground")}>{label}</span>
          </button>

          {/* Out of flow, anchored just under the field. `overflow: hidden` with
              height:auto clips the content exactly at its own box, so the
              translated content is invisible at rest without pinning a pixel
              height — and a month change re-fits for free. */}
          {mounted && (
            <div
              ref={clipRef}
              className="absolute inset-x-0 top-full z-10 overflow-hidden"
              aria-hidden={!open}
            >
              <div ref={contentRef} className="pt-2">
                <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
                  <MonthNavHeader monthAnchor={monthAnchor} onMonthChange={setMonthAnchor} canGoPrev={canGoPrev} />
                  <DayGrid
                    days={gridDays}
                    weekdayLabels={weekdayLabels}
                    monthAnchor={monthAnchor}
                    isSelected={(day) => !!selected && isSameDay(day, selected)}
                    isDisabled={(day) => !!min && format(day, KEY) < min}
                    onSelect={pick}
                    dayLabel={(day) => format(day, "EEEE, MMMM d", { locale: dateLocale })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* THE layout change — the only geometry that moves, and it moves
            instantly. Height is written directly (never React state: it must be
            committed by the time FLIP measures). */}
        <div ref={spacerRef} aria-hidden />
      </div>
    );
  },
);
DateField.displayName = "DateField";

export default DateField;
