// ── Bookings calendar (/bookings) ────────────────────────────────────────────
// The app's main feature: the weekly view of approved bookings. Loads the visible
// window from the bookings service, subscribes to realtime (refetches are coalesced;
// deletes are optimistic), and reconciles via mergeVisibleApprovedBookings. The
// public requests a slot through BookingForm; admins drill in via DayDetailDialog.
// Also listens for the cross-component BOOKING_APPROVED_CHANGED event.
import { Suspense, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, Download, CircleHelp, CalendarDays, ChevronDown } from "lucide-react";
import { addWeeks, isBefore, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  BOOKING_APPROVED_CHANGED_EVENT,
  Booking,
  type BookingApprovedChangedEvent,
  bookingsForDay,
  fmtWeekLabel,
  getWeekDays,
  mergeVisibleApprovedBookings,
  weekRange,
} from "@/lib/booking-utils";
import { EventItem, eventsForDay } from "@/lib/events";
import { DayBox } from "@/components/DayBox";
import { DayDetailDialog } from "@/components/DayDetailDialog";
import { LazyBookingForm } from "@/components/LazyBookingForm";
import { preloadBookingForm } from "@/lib/booking-form-loader";

import { calendarFilename, createIcsCalendar, downloadIcs } from "@/lib/ics";
import { useAdmin } from "@/hooks/useAdmin";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { loadApprovedBookingsForWindow } from "@/services/bookings";
import { loadEvents as loadEventList } from "@/services/events";
import { DaySkeletonCard } from "@/components/PageSkeletons";
import { BookingGuidelinesDialog } from "@/components/BookingGuidelinesDialog";
import { hasDismissedBookingGuidelines } from "@/lib/booking-guidelines";
import { useI18n } from "@/hooks/useI18n";
import { CascadeItem } from "@/components/Cascade";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { getDateLocale, formatLocalizedDate, formatClockTime, formatClockRange } from "@/lib/date";
import type { BookingFormSubmitResult } from "@/components/BookingForm";
import { PageShell } from "@/components/PageShell";
import { PageHeaderBar } from "@/components/PageHeaderBar";

const Index = () => {
  const [searchParams] = useSearchParams();
  const requestedDate = searchParams.get("date");
  const [anchor, setAnchor] = useState<Date>(() => {
    if (!requestedDate) return new Date();
    const parsed = new Date(`${requestedDate}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(() => !hasDismissedBookingGuidelines());
  const [initialLoading, setInitialLoading] = useState(true);
  const initialLoadedRef = useRef(false);
  const { isAdmin, ensureAdminSession } = useAdmin();
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);

  const currentYear = new Date().getFullYear();

  const days = useMemo(() => getWeekDays(anchor), [anchor]);
  const { start, end } = useMemo(() => weekRange(anchor), [anchor]);
  const startTime = start.getTime();
  const endTime = end.getTime();

  const dayData = useMemo(
    () => days.map((day) => ({
      day,
      bookingItems: bookingsForDay(bookings, day),
      dayEvents: eventsForDay(events, day),
    })),
    [bookings, days, events],
  );

  // Mobile stacks the week as one column, which buries today under the days that
  // already passed — so those collapse behind a toggle there. Only the week that
  // contains today mixes past and future days (0 < count < 7); a fully past week
  // keeps all its days visible. Desktop always shows the full 7-up grid.
  const [showPastDays, setShowPastDays] = useState(false);
  useEffect(() => setShowPastDays(false), [anchor]);
  const todayStart = startOfDay(new Date());
  const pastDayCount = dayData.filter(({ day }) => isBefore(day, todayStart)).length;
  const collapsiblePastDays = pastDayCount > 0 && pastDayCount < dayData.length ? pastDayCount : 0;

  useEffect(() => {
    const scheduleIdle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => (
      window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1)
    ));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const idleId = scheduleIdle(() => preloadBookingForm(), { timeout: 2000 });
    return () => cancelIdle(idleId);
  }, []);

  useEffect(() => {
    if (!requestedDate) return;
    const parsed = new Date(`${requestedDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) setAnchor(parsed);
  }, [requestedDate]);

  const load = useCallback(async () => {
    try {
      setBookings(await loadApprovedBookingsForWindow({ startTime, endTime }));
    } catch {
      // Keep the public calendar quiet on transient load failures.
    }
  }, [startTime, endTime]);

  // Load events (window-agnostic — small list)
  const loadEvents = useCallback(async () => {
    try {
      setEvents(await loadEventList());
    } catch {
      // Keep the public calendar quiet on transient load failures.
    }
  }, []);

  useEffect(() => {
    if (!initialLoadedRef.current) return;
    void load();
  }, [load]);

  // Realtime updates — optimistic for DELETE so removed bookings vanish instantly.
  // Refetches are coalesced: a burst of changes (e.g. approving a recurring series
  // fires many INSERTs) collapses into a single authoritative reload instead of one
  // query per event. Correctness is unchanged — every reload is a full window fetch.
  useEffect(() => {
    let active = true;
    let bookingsReconcile: number | undefined;
    let eventsReconcile: number | undefined;
    const scheduleBookingsReload = () => {
      if (bookingsReconcile) window.clearTimeout(bookingsReconcile);
      bookingsReconcile = window.setTimeout(() => { void load(); }, 300);
    };
    const scheduleEventsReload = () => {
      if (eventsReconcile) window.clearTimeout(eventsReconcile);
      eventsReconcile = window.setTimeout(() => { void loadEvents(); }, 300);
    };

    const runInitialLoad = async () => {
      await Promise.allSettled([load(), loadEvents()]);
      if (!active) return;
      initialLoadedRef.current = true;
      setInitialLoading(false);
    };
    const fallbackLoad = window.setTimeout(() => {
      if (!initialLoadedRef.current) void runInitialLoad();
    }, 1200);

    const ch = supabase
      .channel("bookings-public")
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "bookings", filter: "status=eq.approved" }, (payload) => {
        const oldId = (payload.old as { id?: string })?.id;
        if (oldId) setBookings((prev) => prev.filter((b) => b.id !== oldId));
        scheduleBookingsReload();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bookings", filter: "status=eq.approved" }, () => scheduleBookingsReload())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings", filter: "status=eq.approved" }, () => scheduleBookingsReload())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => scheduleEventsReload())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(fallbackLoad);
          if (!initialLoadedRef.current) void runInitialLoad();
        }
      });
    return () => {
      active = false;
      window.clearTimeout(fallbackLoad);
      if (bookingsReconcile) window.clearTimeout(bookingsReconcile);
      if (eventsReconcile) window.clearTimeout(eventsReconcile);
      supabase.removeChannel(ch);
    };
  }, [load, loadEvents]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void Promise.allSettled([load(), loadEvents()]);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, loadEvents]);

  // Admin.tsx and Index.tsx are sibling components with separate state; this
  // bridge lets admin booking mutations notify the public calendar without
  // lifting state or adding a shared context.
  useEffect(() => {
    const onApprovedBookingsChanged = (event: Event) => {
      const detail = (event as BookingApprovedChangedEvent).detail;
      const incoming = detail?.bookings ?? [];
      const deletedIds = detail?.deletedIds ?? [];
      if (incoming.length === 0 && deletedIds.length === 0) return;
      setBookings((current) => {
        const deleted = new Set(deletedIds);
        const remaining = deleted.size > 0 ? current.filter((booking) => !deleted.has(booking.id)) : current;
        return mergeVisibleApprovedBookings(remaining, incoming, startTime, endTime);
      });
      void load();
    };

    window.addEventListener(BOOKING_APPROVED_CHANGED_EVENT, onApprovedBookingsChanged);
    return () => window.removeEventListener(BOOKING_APPROVED_CHANGED_EVENT, onApprovedBookingsChanged);
  }, [endTime, load, startTime]);

  const exportCalendar = () => {
    const bookingEntries = bookings.map((booking) => {
      const bookingTitle = sanitizeDisplayText(booking.title);
      const name = sanitizeDisplayText(booking.name);
      const info = sanitizeDisplayText(booking.info);
      return {
        uid: `booking-${booking.id}`,
        title: bookingTitle,
        start: new Date(booking.start_time),
        end: new Date(booking.end_time),
        description: [`Booked by: ${name}`, info ? `Info: ${info}` : ""].filter(Boolean).join("\n"),
      };
    });
    const eventEntries = events.map((event) => {
      const startDate = new Date(event.event_date);
      return {
        uid: `event-${event.id}`,
        title: sanitizeDisplayText(event.title),
        start: startDate,
        end: event.end_date ? new Date(event.end_date) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000),
        description: sanitizeDisplayText(event.description),
        location: sanitizeDisplayText(event.location),
      };
    });
    const content = createIcsCalendar([...bookingEntries, ...eventEntries]);
    downloadIcs(calendarFilename(anchor, language), content);
  };

  const handleBookingSubmitted = (result: BookingFormSubmitResult) => {
    if (result.type === "created-approved" || result.type === "updated-approved") {
      setBookings((current) => mergeVisibleApprovedBookings(current, result.bookings, startTime, endTime));
    }
    void load();
  };

  return (
    <PageShell className="font-sans text-foreground">
      <PageHeaderBar
        title={t("common.pageBookings")}
        actions={
          <Button
            size="lg"
            onPointerEnter={preloadBookingForm}
            onFocus={preloadBookingForm}
            onClick={() => {
              preloadBookingForm();
              setGuidelinesOpen(false);
              setFormOpen(true);
            }}
            className="btn-cta relative z-10 min-h-12 w-full rounded-full px-5 text-base shadow-lg sm:w-auto sm:px-8 sm:text-lg"
          >
            <Plus className="h-5 w-5" /> {isAdmin ? t("bookings.addBooking") : t("bookings.book")}
          </Button>
        }
      >
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground sm:text-sm">{t("bookings.weeklySchedule")}</p>
      </PageHeaderBar>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
        {/* Print-only weekly schedule — the on-screen toolbar + day grid are
            print:hidden, so this lists every booking (no 4-item card cap). */}
        <div className="hidden print:block">
          <h1 className="mb-3 text-xl font-bold">
            {t("common.pageBookings")} · {fmtWeekLabel(anchor, language)}
          </h1>
          <div className="space-y-2.5">
            {dayData.map(({ day, bookingItems, dayEvents }, i) => (
              <div key={i} className="break-inside-avoid border-b border-black/30 pb-2">
                <div className="text-sm font-semibold">
                  {formatLocalizedDate(day, language, "EEEE, MMM d", "M 月 d 日 EEEE")}
                </div>
                {dayEvents.map((ev) => (
                  <div key={ev.id} className="pl-3 text-sm">
                    ★ {sanitizeDisplayText(ev.title)} — {formatClockTime(new Date(ev.event_date), language)}
                    {ev.location ? ` · ${sanitizeDisplayText(ev.location)}` : ""}
                  </div>
                ))}
                {bookingItems.length === 0 && dayEvents.length === 0 ? (
                  <div className="pl-3 text-sm text-black/50">{t("day.free")}</div>
                ) : (
                  bookingItems.map((it) => (
                    <div key={it.booking.id} className="pl-3 text-sm tabular-nums">
                      {formatClockRange(new Date(it.booking.start_time), new Date(it.booking.end_time), language)}
                      {" · "}
                      <span className="font-medium">{sanitizeDisplayText(it.booking.title)}</span>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>

        {/* One toolbar row on every screen size: week nav, export, guidelines, and
            the week-range picker. On mobile the labelled buttons collapse to icons
            so everything fits a single row; the picker hugs the right edge via
            ml-auto (and wraps gracefully on very narrow screens). */}
        <div className="mb-5 flex flex-wrap items-center gap-1.5 print:hidden">
          <Button variant="outline" size="icon" onClick={() => setAnchor((d) => addWeeks(d, -1))} aria-label={t("common.previousWeek")} className="h-11 w-11 active:scale-[0.97] active:duration-tap sm:h-9 sm:w-9">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())} className="h-11 px-3 sm:h-9 sm:px-4">{t("common.today")}</Button>
          <Button variant="outline" size="icon" onClick={() => setAnchor((d) => addWeeks(d, 1))} aria-label={t("common.nextWeek")} className="h-11 w-11 active:scale-[0.97] active:duration-tap sm:h-9 sm:w-9">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={exportCalendar} aria-label={t("bookings.export")} className="h-11 w-11 px-0 sm:h-9 sm:w-auto sm:px-4">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t("bookings.export")}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setFormOpen(false); setGuidelinesOpen(true); }} aria-label={t("bookings.guidelines")} className="h-11 w-11 px-0 sm:h-9 sm:w-auto sm:px-4">
            <CircleHelp className="h-4 w-4" />
            <span className="hidden sm:inline">{t("bookings.guidelines")}</span>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label={fmtWeekLabel(anchor, language)}
                className="group ml-auto h-11 max-w-full px-3 text-base tabular-nums sm:h-9 sm:px-4"
              >
                <CalendarDays aria-hidden="true" />
                {/* The week range is long on mobile, so there it collapses to a bare
                    calendar icon (the range still reads out via aria-label). */}
                <span className="hidden min-w-0 truncate sm:inline">{fmtWeekLabel(anchor, language)}</span>
                <ChevronDown aria-hidden="true" className="transition-transform duration-base group-data-[state=open]:rotate-180" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" sideOffset={10} collisionPadding={16} className="w-auto max-w-[calc(100vw-1.5rem)] rounded-2xl p-2 shadow-elev">
              <Calendar
                mode="single"
                selected={anchor}
                month={anchor}
                onMonthChange={setAnchor}
                onSelect={(date) => {
                  if (date) setAnchor(date);
                }}
                captionLayout="dropdown"
                fromYear={currentYear}
                toYear={currentYear + 1}
                locale={dateLocale}
                initialFocus
                className="max-w-full"
                classNames={{
                  nav: "hidden",
                  caption: "flex justify-center pt-1 relative items-center",
                  caption_label: "pointer-events-none inline-flex items-center gap-1 rounded-full px-4 py-2 text-base font-semibold text-foreground",
                  caption_dropdowns: "flex max-w-full min-w-0 items-center justify-center gap-2",
                  dropdown:
                    "absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0",
                  dropdown_month:
                    "group relative inline-flex h-11 min-w-0 max-w-[8.25rem] flex-1 items-center justify-center rounded-full border border-border bg-background px-3 shadow-soft transition-colors hover:border-primary/40",
                  dropdown_year:
                    "group relative inline-flex h-11 min-w-0 max-w-[6.75rem] flex-1 items-center justify-center rounded-full border border-border bg-background px-3 shadow-soft transition-colors hover:border-primary/40",
                  dropdown_icon:
                    "ml-1 h-4 w-4 text-primary",
                  vhidden: "sr-only",
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {collapsiblePastDays > 0 && (
          <button
            type="button"
            onClick={() => setShowPastDays((current) => !current)}
            aria-expanded={showPastDays}
            className="mb-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground shadow-sm frost-panel transition-colors duration-fast hover:text-foreground dark:shadow-none print:hidden sm:hidden"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn("h-4 w-4 transition-transform duration-base", showPastDays && "rotate-180")}
            />
            {showPastDays ? t("bookings.hidePastDays") : t("bookings.showPastDays", { count: collapsiblePastDays })}
          </button>
        )}
        <div
          className="grid min-w-0 grid-cols-1 gap-3 print:hidden sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-7"
          aria-busy={initialLoading}
        >
          {dayData.map(({ day, bookingItems, dayEvents }, i) => {
            const isPastDay = isBefore(day, todayStart);
            return (
              <CascadeItem
                key={i}
                index={i}
                className={cn(
                  "min-w-0",
                  // Collapsed past days disappear from the mobile column only; when
                  // revealed they stay slightly dimmed so today still leads. Desktop
                  // is untouched either way.
                  collapsiblePastDays > 0 && isPastDay && (showPastDays ? "max-sm:opacity-70" : "max-sm:hidden"),
                )}
              >
                {initialLoading ? (
                  <DaySkeletonCard />
                ) : (
                  <DayBox
                    day={day}
                    bookingItems={bookingItems}
                    dayEvents={dayEvents}
                    onClick={() => setOpenDay(day)}
                  />
                )}
              </CascadeItem>
            );
          })}
        </div>

      </main>

      <DayDetailDialog day={openDay} bookings={bookings} events={events} onClose={() => setOpenDay(null)} />
      <BookingGuidelinesDialog open={guidelinesOpen} onOpenChange={setGuidelinesOpen} />
      <Suspense fallback={null}>
        <LazyBookingForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          approvedBookings={bookings}
          onSubmitted={handleBookingSubmitted}
          adminMode={isAdmin}
          ensureAdminSession={ensureAdminSession}
        />
      </Suspense>
    </PageShell>
  );
};

export default Index;
