import { useMemo, useState } from "react";
import { addWeeks } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DayBox } from "@/components/DayBox";
import { Booking, bookingsForDay, fmtWeekLabel, getWeekDays } from "@/lib/booking-utils";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";

interface AdminWeekViewProps {
  /** Approved bookings — the week strip only shows what's confirmed on the calendar. */
  bookings: Booking[];
  /** Tapping a day bubbles up so the page can open that day's bookings → edit flow. */
  onSelectDay: (day: Date) => void;
}

/**
 * Compact week overview for the admin page. Reuses the public calendar's DayBox
 * so admins see the same day cards, scoped to one week with prev/next. Read-only
 * here — day taps are handled by the page (open the day, then edit a booking).
 *
 * Collapsible: the calendar eats the top of a phone screen and pushes the pending
 * queue (the primary task) below the fold, so it starts collapsed on mobile and
 * expanded on desktop, where there's room. The body uses a grid-rows 0fr→1fr reveal
 * (GPU-cheap, no max-height guessing).
 */
export const AdminWeekView = ({ bookings, onSelectDay }: AdminWeekViewProps) => {
  const { language, t } = useI18n();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [open, setOpen] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  const days = useMemo(() => getWeekDays(anchor), [anchor]);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-lg">
      {/* Header doubles as the collapse toggle — a full-width tap target on mobile. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="admin-week-body"
        className="flex w-full items-center justify-between gap-2 p-3 text-left sm:p-4"
      >
        <span className="font-sans text-base font-semibold text-foreground">
          {t("admin.weeklyCalendar")}
        </span>
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-fast",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id="admin-week-body"
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-3 pb-3 sm:px-4 sm:pb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="font-sans text-base font-semibold tabular-nums text-foreground">
                {fmtWeekLabel(anchor, language)}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setAnchor((d) => addWeeks(d, -1))}
                  aria-label={t("common.previousWeek")}
                  className="h-9 w-9 active:scale-[0.97] active:duration-tap"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())} className="h-9 px-3">
                  {t("common.today")}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setAnchor((d) => addWeeks(d, 1))}
                  aria-label={t("common.nextWeek")}
                  className="h-9 w-9 active:scale-[0.97] active:duration-tap"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {days.map((day) => (
                // Reserve a consistent cell height so cards don't jump when bookings
                // load in (DayBox is short for free days, taller for booked ones —
                // without this the strip reflows on first data arrival).
                <div key={day.toISOString()} className="flex min-h-[9.5rem]">
                  <DayBox
                    day={day}
                    bookingItems={bookingsForDay(bookings, day)}
                    onClick={() => onSelectDay(day)}
                    editable
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
