// ── Month nav header ─────────────────────────────────────────────────────────
// "July 2026" + prev/next, shared by both calendars (DateField's single-date picker and
// MonthDatePicker's pick-dates grid) so their nav can't drift apart. `canGoPrev` is how
// a caller pins the calendar at its earliest bookable month.
import type { ReactNode } from "react";
import { addMonths, format, isSameMonth } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import { getDateLocale } from "@/lib/date";
import { cn } from "@/lib/utils";

interface Props {
  monthAnchor: Date;
  onMonthChange: (next: Date) => void;
  canGoPrev?: boolean;
  /** Pins the calendar at its latest bookable month — the mirror of canGoPrev. */
  canGoNext?: boolean;
  /** Tighter controls for a picker dropdown, which must fit without scrolling. */
  compact?: boolean;
  /**
   * Rendered at the end of the control group. Lets a host put its confirm action
   * on this row instead of a separate bordered footer — worth ~49px, which is the
   * difference between the multi-date panel fitting on a phone and not.
   */
  trailing?: ReactNode;
}

export const MonthNavHeader = ({ monthAnchor, onMonthChange, canGoPrev = true, canGoNext = true, compact = false, trailing }: Props) => {
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium leading-none tabular-nums text-foreground">
        {format(monthAnchor, "MMMM yyyy", { locale: dateLocale })}
      </span>
      <div className="flex items-center gap-1.5">
        {/* One tap back to the current month after browsing ahead. Disabled
            rather than hidden while already on it, so the chevrons never shift
            position under the user's thumb mid-navigation. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onMonthChange(new Date())}
          disabled={isSameMonth(monthAnchor, new Date())}
          aria-label={t("bookingForm.jumpToToday")}
          className={cn("px-2.5 text-xs font-medium active:scale-[0.97] active:duration-tap", compact ? "h-8" : "h-9")}
        >
          {t("bookingForm.today")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onMonthChange(addMonths(monthAnchor, -1))}
          disabled={!canGoPrev}
          aria-label={t("bookingForm.previousMonth")}
          className={cn("active:scale-[0.97] active:duration-tap", compact ? "h-8 w-8" : "h-9 w-9")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onMonthChange(addMonths(monthAnchor, 1))}
          disabled={!canGoNext}
          aria-label={t("bookingForm.nextMonth")}
          className={cn("active:scale-[0.97] active:duration-tap", compact ? "h-8 w-8" : "h-9 w-9")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {trailing}
      </div>
    </div>
  );
};

export default MonthNavHeader;
