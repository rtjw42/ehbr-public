import { memo } from "react";
import { format, isToday } from "date-fns";
import { bookingsForDay } from "@/lib/booking-utils";
import { EventItem } from "@/lib/events";
import { BookingChip } from "./BookingChip";
import { Music, Pencil } from "lucide-react";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { useI18n } from "@/hooks/useI18n";
import { useMotionTier } from "@/hooks/useMotionTier";
import { formatClockTime, formatLocalizedDate, getDateLocale } from "@/lib/date";
import { cn } from "@/lib/utils";

interface Props {
  day: Date;
  bookingItems: ReturnType<typeof bookingsForDay>;
  dayEvents?: EventItem[];
  onClick: () => void;
  /**
   * Admin-only: shows a visible "Edit" pencil affordance on days that have
   * bookings, so it's obvious the card is tap-to-edit (opens the day's edit
   * flow). Off for the public calendar — the card there is read-only detail.
   */
  editable?: boolean;
}

export const DayBox = memo(({ day, bookingItems, dayEvents = [], onClick, editable = false }: Props) => {
  const items = bookingItems;
  const today = isToday(day);
  const free = items.length === 0 && dayEvents.length === 0;
  const visibleItems = items.slice(0, 4);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);
  const ariaDate = formatLocalizedDate(day, language, "EEEE, MMMM d", "EEEE, M 月 d 日");
  // Day-card press scale is full-tier only. On lite the day-detail popup
  // is the tap feedback, so the press animation is dropped (decision locked in
  // the Motion System plan; day cards only — other buttons keep their press).
  const pressClass =
    useMotionTier() === "full"
      ? "transition-transform [transition-duration:280ms] ease-out active:scale-[0.97] active:duration-base active:ease-in-out"
      : "";

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[var(--radius-lg)] p-3 text-left shadow-sm frost-panel focus-visible:z-10 dark:shadow-none sm:p-4",
        pressClass,
        free
          ? "min-h-[4.5rem] sm:min-h-[clamp(9.5rem,38vw,13rem)]"
          : "min-h-[clamp(9.5rem,38vw,13rem)]",
        today && "ring-2 ring-[hsl(var(--foreground))]",
      )}
      aria-label={t("day.aria", { date: ariaDate, bookings: items.length, events: dayEvents.length })}
    >
      <div className="mb-2 flex min-w-0 items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display type-badge uppercase tracking-widest text-muted-foreground font-medium">
            {format(day, "EEE", { locale: dateLocale })}
          </div>
          <div className="font-display text-[clamp(2.25rem,9vw,3rem)] leading-none tracking-tight text-foreground">
            {format(day, "d", { locale: dateLocale })}
          </div>
        </div>
        {items.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {editable && (
              // Not a nested button (the whole card is the tap target) — a visible
              // cue that this admin card opens the edit flow. group-hover/active
              // lifts it so it reads as interactive.
              <span className="inline-flex items-center gap-1 rounded-full border border-foreground/20 bg-foreground/[0.06] px-2 py-0.5 type-badge font-medium text-foreground/70 transition-colors group-hover:bg-foreground/10 group-hover:text-foreground group-active:bg-foreground/10">
                <Pencil aria-hidden className="h-3 w-3" />
                {t("day.edit")}
              </span>
            )}
            {/* Just the count in a circular pill — the full "N bookings" is in the
                card's aria-label, so this stays terse and leaves room for Edit. */}
            <span
              aria-hidden
              className="grid h-6 min-w-6 place-items-center rounded-full bg-foreground/10 px-1.5 type-badge font-semibold tabular-nums text-foreground/80"
            >
              {items.length}
            </span>
          </div>
        )}
      </div>

      {/* Event banners */}
      {dayEvents.length > 0 && (
        <div className="mb-2 min-w-0 space-y-1">
          {dayEvents.map((ev) => (
            <div
              key={ev.id}
              className="relative flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-foreground/25 bg-foreground/[0.08] px-2 py-1.5"
              title={sanitizeDisplayText(ev.title)}
            >
              {ev.poster_url ? (
                <img src={ev.poster_url} alt="" className="h-7 w-7 rounded object-cover shrink-0" />
              ) : (
                <div className="h-7 w-7 rounded bg-foreground/15 flex items-center justify-center shrink-0">
                  <Music className="h-3.5 w-3.5 text-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate type-chip font-semibold leading-tight">{sanitizeDisplayText(ev.title)}</div>
                <div className="truncate text-[clamp(0.6rem,1.8vw,0.68rem)] text-muted-foreground tabular-nums">
                  {formatClockTime(new Date(ev.event_date), language)}
                  {ev.location && <> · <span className="truncate">{sanitizeDisplayText(ev.location)}</span></>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="relative min-w-0 flex-1 overflow-hidden">
        {items.length === 0 ? (
          <div className={cn(
            "text-xs text-muted-foreground/60 italic",
            free ? "pt-0.5 sm:flex sm:h-full sm:items-center sm:justify-center" : "flex h-full items-center justify-center",
          )}>
            {t("day.free")}
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleItems.map((it) => (
              <BookingChip
                key={it.booking.id}
                booking={it.booking}
                day={day}
                isContinued={it.isContinued}
              />
            ))}
            {hiddenCount > 0 && (
              <div className="rounded-lg border border-dashed border-foreground/25 bg-foreground/[0.06] px-2 py-1.5 text-center type-chip font-medium text-muted-foreground">
                {t("day.more", { count: hiddenCount })}
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
});

DayBox.displayName = "DayBox";
