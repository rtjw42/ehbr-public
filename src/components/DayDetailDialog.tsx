// ── Day detail dialog ────────────────────────────────────────────────────────
// Tapping a calendar day opens this: the day's bookings and events in detail. It's
// read-only for the public; in admin mode the page wires day taps into the edit flow.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { crossfadeTransition } from "@/lib/motion";
import { Resize } from "@/components/ui/resize";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Booking, bookingsForDay, bookingBg, bookingBorder, bookingDot, fmtTimeRange } from "@/lib/booking-utils";
import { EventItem, eventsForDay } from "@/lib/events";
import { ArrowLeft, CalendarClock, ChevronDown, ChevronUp, MapPin, Music, Pencil, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { useI18n } from "@/hooks/useI18n";
import { formatClockRange, formatClockTime, formatDateAtTime, formatLocalizedDate } from "@/lib/date";

interface Props {
  day: Date | null;
  bookings: Booking[];
  events?: EventItem[];
  onClose: () => void;
  /**
   * Admin-only: when provided, clicking a booking calls this (e.g. to open the
   * edit form) instead of showing the read-only detail view. Public calendar
   * leaves it undefined.
   */
  onEditBooking?: (booking: Booking) => void;
  /**
   * Admin-only: when provided, each booking row gets a delete affordance. The page
   * owns the confirm (single vs series) — this only reports which booking.
   */
  onDeleteBooking?: (booking: Booking) => void;
}

type DetailView =
  | { kind: "list" }
  | { kind: "booking"; booking: Booking; isContinued: boolean }
  | { kind: "event"; event: EventItem };

export const DayDetailDialog = ({ day, bookings, events = [], onClose, onEditBooking, onDeleteBooking }: Props) => {
  const items = day ? bookingsForDay(bookings, day) : [];
  const dayEvents = day ? eventsForDay(events, day) : [];
  const [view, setView] = useState<DetailView>({ kind: "list" });
  const { language, t } = useI18n();
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  // Keyed view swaps fade on every switch but enter at rest on the dialog's
  // opening render (the dialog entrance owns that moment) — same pattern as
  // BookingForm's swapFadeInitial.
  const swapFadeReadyRef = useRef(false);
  useEffect(() => {
    swapFadeReadyRef.current = !!day;
  }, [day]);
  const dayKey = day?.toISOString() ?? "";

  useEffect(() => {
    setView({ kind: "list" });
  }, [dayKey]);

  // A new view starts at its top, not the previous view's scroll offset. Instant
  // — the <Resize> dep-glide carries the visual continuity.
  useEffect(() => {
    bodyScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  const goBack = () => {
    setView({ kind: "list" });
  };
  const title = day
    ? formatLocalizedDate(day, language, "EEEE, MMMM d", "EEEE, M 月 d 日")
    : "";

  return (
    <Dialog open={!!day} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-[min(32rem,calc(100vw-1rem))]"
        onEscapeKeyDown={(event) => {
          if (view.kind !== "list") {
            event.preventDefault();
            goBack();
          }
        }}
      >
        <DialogHeader>
          <div className="flex min-w-0 items-start gap-2">
            {view.kind !== "list" && (
              <Button type="button" variant="ghost" size="icon" onClick={goBack} aria-label={t("common.back")} className="mt-0.5 h-9 w-9 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle className="min-w-0">
              {view.kind === "list" ? title : t("day.details")}
            </DialogTitle>
          </div>
        </DialogHeader>

        <DialogBody className="p-0" scrollRef={bodyScrollRef}>
          {/* View swaps = ONE dep-glide + a keyed crossfade (Phase M2.5, same as
              the booking form's steps): the surface's height glides old → new
              while the new view fades in — the "day card resize". */}
          <Resize show dep={view.kind}>
          <motion.div
            key={view.kind}
            initial={swapFadeReadyRef.current ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={crossfadeTransition}
            className="p-3 sm:p-4"
          >
            {view.kind === "list" ? (
              <DayListView
                day={day}
                dayEvents={dayEvents}
                items={items}
                editMode={!!onEditBooking}
                onDeleteBooking={onDeleteBooking}
                onOpenBooking={(booking, isContinued) => {
                  if (onEditBooking) {
                    onEditBooking(booking);
                    return;
                  }
                  setView({ kind: "booking", booking, isContinued });
                }}
                onOpenEvent={(event) => {
                  setView({ kind: "event", event });
                }}
              />
            ) : view.kind === "booking" ? (
              <BookingDetailView day={day} booking={view.booking} isContinued={view.isContinued} />
            ) : (
              <EventDetailView event={view.event} />
            )}
          </motion.div>
          </Resize>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};

const DayListView = ({
  day,
  dayEvents,
  items,
  editMode = false,
  onDeleteBooking,
  onOpenBooking,
  onOpenEvent,
}: {
  day: Date | null;
  dayEvents: EventItem[];
  items: ReturnType<typeof bookingsForDay>;
  // Admin mode: tapping a booking opens the edit form, so each row shows a visible
  // Pencil affordance (the public read-only rows look identical otherwise).
  editMode?: boolean;
  onDeleteBooking?: (booking: Booking) => void;
  onOpenBooking: (booking: Booking, isContinued: boolean) => void;
  onOpenEvent: (event: EventItem) => void;
}) => {
  const { language, t } = useI18n();

  return (
    <div className="-mx-1 space-y-4 px-1 py-1">
      {dayEvents.length > 0 && (
        <div className="mb-4 space-y-3">
          <h3 className="type-eyebrow text-muted-foreground">{t("day.events")}</h3>
          {dayEvents.map((ev) => (
            <button
              key={ev.id}
              type="button"
              onClick={() => onOpenEvent(ev)}
              className="w-full overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-muted text-left transition-[background-color,border-color,box-shadow,opacity] hover:border-foreground/25 hover:bg-card focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]"
              aria-label={t("day.openEvent", { title: sanitizeDisplayText(ev.title) })}
            >
              {ev.poster_url && (
                <img src={ev.poster_url} alt={sanitizeDisplayText(ev.title)} className="h-24 w-full object-cover sm:h-32" />
              )}
              <div className="p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Music className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 truncate font-semibold">{sanitizeDisplayText(ev.title)}</div>
                </div>
                <div className="mt-1 text-sm tabular-nums text-foreground/80">
                  {formatClockTime(new Date(ev.event_date), language)}
                  {ev.end_date && ` - ${formatClockTime(new Date(ev.end_date), language)}`}
                </div>
                {ev.location && (
                  <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 truncate">{sanitizeDisplayText(ev.location)}</span>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {dayEvents.length > 0 && items.length > 0 && (
          <h3 className="type-eyebrow pt-2 text-muted-foreground">{t("day.bookings")}</h3>
        )}
        {items.length === 0 && dayEvents.length === 0 && (
          <p className="py-6 text-center text-sm italic text-muted-foreground">
            {t("day.noBookings")}
          </p>
        )}
        {items.map(({ booking, isContinued }) => (
          // The card is a container, not the tap target: delete is a sibling button,
          // since a button can't nest inside a button. Row tap keeps the whole
          // remaining width.
          <div
            key={booking.id}
            className="flex items-stretch overflow-hidden rounded-xl border transition-[box-shadow,opacity]"
            style={{ backgroundColor: bookingBg(booking), borderColor: bookingBorder(booking) }}
          >
            <button
              type="button"
              onClick={() => onOpenBooking(booking, isContinued)}
              className="min-w-0 flex-1 p-3 text-left focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]"
              aria-label={editMode
                ? t("day.editBooking", { name: sanitizeDisplayText(booking.title) })
                : t("day.openBooking", { name: sanitizeDisplayText(booking.title) })}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: bookingDot(booking) }} />
                <div className="min-w-0 flex-1 truncate font-semibold">
                  {sanitizeDisplayText(booking.title)}
                  {isContinued && <span className="font-normal opacity-60"> ({t("day.continued")})</span>}
                </div>
              </div>
              <div className="mt-1 break-words text-sm tabular-nums text-foreground/80">
                {day ? fmtTimeRange(booking, day, language) : ""}
              </div>
            </button>
            {/* Both admin icons share one right-hand rail, centred over the card's
                full height so they line up with each other. The pencil is a real
                button (not a hint glyph) because it now looks like one next to the
                trash — it just repeats what tapping the row body does. */}
            {editMode && (
              <button
                type="button"
                onClick={() => onOpenBooking(booking, isContinued)}
                aria-label={t("day.editBooking", { name: sanitizeDisplayText(booking.title) })}
                className="grid w-11 shrink-0 place-items-center text-foreground/50 transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </button>
            )}
            {onDeleteBooking && (
              <button
                type="button"
                onClick={() => onDeleteBooking(booking)}
                aria-label={t("day.deleteBooking", { name: sanitizeDisplayText(booking.title) })}
                className="grid w-11 shrink-0 place-items-center text-foreground/40 transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-destructive"
              >
                <Trash2 aria-hidden className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const BookingDetailView = ({ day, booking, isContinued }: { day: Date | null; booking: Booking; isContinued: boolean }) => {
  const { language, t } = useI18n();
  const start = new Date(booking.start_time);
  const end = new Date(booking.end_time);
  const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const info = sanitizeDisplayText(booking.info);

  return (
    <div className="-mx-1 px-1 py-1">
      <div className="rounded-xl border p-4" style={{ backgroundColor: bookingBg(booking), borderColor: bookingBorder(booking) }}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: bookingDot(booking) }} />
          <div className="min-w-0 flex-1">
            <h3 className="type-item-title break-words">{sanitizeDisplayText(booking.title)}</h3>
            {isContinued && <p className="mt-1 text-sm text-muted-foreground">{t("day.continued")}</p>}
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm">
          <DetailLine icon={<CalendarClock className="h-4 w-4" />} label={t("day.time")}>
            {day ? fmtTimeRange(booking, day, language) : formatClockRange(start, end, language)}
          </DetailLine>
          <DetailLine label={t("day.duration")}>{formatDuration(durationMinutes)}</DetailLine>
          <DetailLine icon={<UserRound className="h-4 w-4" />} label={t("day.bookedBy")}>
            {sanitizeDisplayText(booking.name)}
          </DetailLine>
          {booking.status === "approved" && booking.approved_by_name && (
            <DetailLine icon={<ShieldCheck className="h-4 w-4" />} label={t("day.approvedBy")}>
              {sanitizeDisplayText(booking.approved_by_name)}
            </DetailLine>
          )}
        </div>

        {info && <ExpandableText className="mt-4" label={t("day.info")} text={info} />}
      </div>
    </div>
  );
};

const EventDetailView = ({ event }: { event: EventItem }) => {
  const { language, t } = useI18n();
  const start = new Date(event.event_date);
  const end = event.end_date ? new Date(event.end_date) : null;
  const description = sanitizeDisplayText(event.description);

  return (
    <div className="-mx-1 px-1 py-1">
      <div className="overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 to-accent/10">
        {event.poster_url && <img src={event.poster_url} alt={sanitizeDisplayText(event.title)} className="h-28 w-full object-cover sm:h-40" />}
        <div className="p-4">
          <div className="flex min-w-0 items-start gap-2">
            <Music className="mt-1 h-4 w-4 shrink-0 text-primary" />
            <h3 className="type-item-title min-w-0 break-words">{sanitizeDisplayText(event.title)}</h3>
          </div>
          <div className="mt-4 grid gap-3 text-sm">
            <DetailLine icon={<CalendarClock className="h-4 w-4" />} label={t("day.time")}>
              {formatDateAtTime(start, language, "EEE, MMM d", "M 月 d 日 EEE")}
              {end && ` - ${formatClockTime(end, language)}`}
            </DetailLine>
            {event.location && (
              <DetailLine icon={<MapPin className="h-4 w-4" />} label={t("eventForm.location")}>
                {sanitizeDisplayText(event.location)}
              </DetailLine>
            )}
          </div>
          {description && <ExpandableText className="mt-4" label={t("day.description")} text={description} />}
        </div>
      </div>
    </div>
  );
};

const DetailLine = ({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) => (
  <div className="flex items-start gap-2">
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-primary">{icon}</span>
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="break-words text-foreground/85">{children}</div>
    </div>
  </div>
);

const ExpandableText = ({ className = "", label, text }: { className?: string; label: string; text: string }) => {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background/70 px-3 py-2 text-left text-sm font-medium transition-[background-color,border-color,box-shadow,opacity] hover:bg-interactive hover:text-interactive-text focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]"
        aria-expanded={expanded}
      >
        <span>{label}</span>
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          {expanded ? t("day.showLess") : t("day.showMore")}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-slow ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">
          <p className="px-3 pt-3 text-sm leading-relaxed text-foreground/80">{text}</p>
        </div>
      </div>
    </div>
  );
};

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
};
