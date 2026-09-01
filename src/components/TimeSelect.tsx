// ── Time field (inline panel host for the shared wheel) ──────────────────────
// LEGACY HOST. The wheel itself now lives in `ui/time-wheel.tsx` (one implementation,
// shared with the Form System's PickerDropdown). This file is just the
// inline-expanding field that EventForm still uses; it will be retired when EventForm
// migrates onto the FormShell (see PLANS Current #2).
//
// Format follows the app's own 12h/24h preference (not the phone's). Round-trips
// "HH:mm", so nothing downstream changes.
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Clock } from "lucide-react";
import { useFlipPanel } from "@/hooks/useFlipPanel";
import { useI18n } from "@/hooks/useI18n";
import { usePreferences } from "@/hooks/usePreferences";
import { Button } from "@/components/ui/button";
import { TimeWheel } from "@/components/ui/time-wheel";
import { formatClockTime } from "@/lib/date";
import { openPicker, releasePicker } from "@/lib/picker-registry";
import { cn } from "@/lib/utils";

interface Props {
  id?: string;
  value: string; // "HH:mm"
  onChange: (value: string) => void;
  /** Combinations before this "HH:mm" are disabled (same-day floor); omit for none. */
  minTime?: string;
  ariaInvalid?: boolean;
  className?: string;
}

const parseHm = (hm: string): { h: number; m: number } => {
  const [h, m] = hm.split(":").map(Number);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
};

export const TimeSelect = forwardRef<HTMLButtonElement, Props>(
  ({ id, value, onChange, minTime, ariaInvalid, className }, ref) => {
    const { timeFormat } = usePreferences();
    const { language, t } = useI18n();
    const hour12 = timeFormat === "12h";
    const [open, setOpen] = useState(false);
    // Panel mechanics (mount lifetime, spacer, FLIP, pan + its exact reverse)
    // all live in the shared recipe — see hooks/useFlipPanel.ts.
    const { mounted, rootRef, contentRef, clipRef, spacerRef } = useFlipPanel(open);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const label = useCallback(
      (hm: string) => {
        const { h, m } = parseHm(hm);
        return formatClockTime(new Date(2000, 0, 1, h, m), language, { hour12 });
      },
      [language, hour12],
    );

    // Done / Escape. No return-pan: nothing above the trigger ever moved, so
    // there is nowhere to return to — the field stayed under the user's thumb the
    // whole time. preventScroll because the browser's focus auto-scroll would
    // fight the FLIP.
    const closePanel = useCallback(() => {
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }, []);
    // Registry close: another picker is taking over.
    const closeSelf = useCallback(() => setOpen(false), []);

    // Deliberately NO outside-tap close (unlike a stray tap): a tap outside mid-spin —
    // easy while thumbing a wheel — would discard the adjustment. Dismissed only by the
    // Done button or Escape. Opening another picker still closes this one via the shared
    // registry, so at most one inline panel is expanded at a time.
    useEffect(() => {
      if (open) openPicker(closeSelf);
      else releasePicker(closeSelf);
      return () => releasePicker(closeSelf);
    }, [open, closeSelf]);

    return (
      <div
        ref={rootRef}
        // Escape dismisses the open wheel (keeping the live value) and stops there, so it
        // never bubbles to the surrounding Radix Dialog and closes the whole form. Handled
        // at the root so it works from a column OR the trigger. When closed, Escape passes
        // through to the dialog as normal.
        onKeyDown={(e) => {
          if (open && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closePanel();
          }
        }}
        className={cn("min-w-0", className)}
      >
        <div className="relative">
          <button
            id={id}
            ref={(node) => {
              triggerRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) ref.current = node;
            }}
            type="button"
            aria-invalid={ariaInvalid || undefined}
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => setOpen((o) => !o)}
            className={cn(
              "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-none transition-[border-color,box-shadow] [-webkit-tap-highlight-color:transparent]",
              "focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]",
              "aria-[invalid=true]:border-destructive",
              open && "border-foreground/40",
            )}
          >
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-semibold tabular-nums">
              {value ? label(value) : "--"}
            </span>
            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          {/* Out of flow, anchored just under the field — the wheel's height never
            animates; the spacer below carries the layout change and <FlipScope>
            turns the resulting displacement into compositor transforms. See
            hooks/useFlipPanel.ts for why the panel is absolute. */}
          {mounted && (
            <div
              ref={clipRef}
              className="absolute inset-x-0 top-full z-10 overflow-hidden"
              aria-hidden={!open}
            >
              <div ref={contentRef} className="pt-2">
                <div className="flex flex-col rounded-lg border border-border bg-card/60 p-2">
                  <TimeWheel value={value} onChange={onChange} minTime={minTime} />

                  {/* Only this button (or Escape) dismisses the wheel — the value is already
                    live, so this is a "done adjusting" affordance, not a commit gate. */}
                  <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
                    <Button type="button" size="sm" onClick={closePanel} className="gap-1.5">
                      <Check className="h-4 w-4" aria-hidden />
                      {t("common.done")}
                    </Button>
                  </div>
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
TimeSelect.displayName = "TimeSelect";

export default TimeSelect;
