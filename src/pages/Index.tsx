import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, CalendarIcon, Download } from "lucide-react";
import { addWeeks, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Booking, fmtWeekLabel, getWeekDays, weekRange } from "@/lib/booking-utils";
import { EventItem } from "@/lib/events";
import { DayBox } from "@/components/DayBox";
import { DayDetailDialog } from "@/components/DayDetailDialog";
import { BookingForm } from "@/components/BookingForm";
import { ReminderSignup } from "@/components/ReminderSignup";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import bauhausBg from "@/assets/bauhaus-music-bg.jpg";
import { calendarFilename, createIcsCalendar, downloadIcs } from "@/lib/ics";
import { useAdmin } from "@/hooks/useAdmin";

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
  const { isAdmin, ensureAdminSession } = useAdmin();

  const days = getWeekDays(anchor);
  const { start, end } = weekRange(anchor);

  useEffect(() => {
    if (!requestedDate) return;
    const parsed = new Date(`${requestedDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) setAnchor(parsed);
  }, [requestedDate]);

  const load = useCallback(async () => {
    // pull approved bookings overlapping the window (with 1d slack on each side for spillover display)
    const from = new Date(start); from.setDate(from.getDate() - 1);
    const to = new Date(end); to.setDate(to.getDate() + 1);
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "approved")
      .lte("start_time", to.toISOString())
      .gte("end_time", from.toISOString())
      .order("start_time", { ascending: true });
    if (!error && data) setBookings(data as Booking[]);
  }, [start, end]);

  // Load events (window-agnostic — small list)
  const loadEvents = useCallback(async () => {
    const { data } = await supabase.from("events").select("*").order("event_date", { ascending: true });
    if (data) setEvents(data as EventItem[]);
  }, []);

  // Realtime updates — optimistic for DELETE so removed bookings vanish instantly
  useEffect(() => {
    const fallbackLoad = window.setTimeout(() => {
      load();
      loadEvents();
    }, 1200);

    const ch = supabase
      .channel("bookings-public")
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "bookings" }, (payload) => {
        const oldId = (payload.old as { id?: string })?.id;
        if (oldId) setBookings((prev) => prev.filter((b) => b.id !== oldId));
        load();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bookings" }, () => load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => loadEvents())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(fallbackLoad);
          load();
          loadEvents();
        }
      });
    return () => {
      window.clearTimeout(fallbackLoad);
      supabase.removeChannel(ch);
    };
  }, [load, loadEvents]);

  const [pickerOpen, setPickerOpen] = useState(false);

  const exportCalendar = () => {
    const bookingEntries = bookings.map((booking) => ({
      uid: `booking-${booking.id}`,
      title: booking.name,
      start: new Date(booking.start_time),
      end: new Date(booking.end_time),
      description: booking.contact,
    }));
    const eventEntries = events.map((event) => {
      const startDate = new Date(event.event_date);
      return {
        uid: `event-${event.id}`,
        title: event.title,
        start: startDate,
        end: event.end_date ? new Date(event.end_date) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000),
        description: event.description,
        location: event.location,
      };
    });
    const content = createIcsCalendar([...bookingEntries, ...eventEntries]);
    downloadIcs(calendarFilename(anchor), content);
  };

  return (
    <div className="app-page-bg min-h-screen relative overflow-hidden page-transition">
      {/* Bauhaus music background — decorative */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.18] bg-no-repeat bg-cover bg-center mix-blend-multiply"
        style={{ backgroundImage: `url(${bauhausBg})` }}
      />
      {/* Floating geometric Bauhaus shapes */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-[8%] -top-[8%] h-[clamp(10rem,28vw,16rem)] w-[clamp(10rem,28vw,16rem)] rounded-full bg-[hsl(15_55%_55%/0.10)] animate-float-slow" />
        <div className="absolute -right-[10%] top-1/3 h-[clamp(12rem,34vw,20rem)] w-[clamp(12rem,34vw,20rem)] rounded-full bg-[hsl(40_70%_50%/0.10)] animate-float-slower" />
        <div className="absolute bottom-[6%] left-1/4 h-0 w-0 border-l-[clamp(3rem,9vw,5rem)] border-r-[clamp(3rem,9vw,5rem)] border-b-[clamp(5rem,15vw,9rem)] border-l-transparent border-r-transparent border-b-[hsl(80_25%_40%/0.10)] animate-float-slow" />
      </div>

      <header className="border-b bg-card/60 backdrop-blur relative z-30">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center gap-4 sm:gap-6 min-w-0">
            <div className="min-w-0">
              <h1 className="font-display text-[clamp(2.5rem,12vw,4.5rem)] text-primary leading-none tracking-tight">Band Room</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-2 uppercase tracking-[0.25em]">Weekly schedule</p>
            </div>
          </div>
          <Button
            size="lg"
            onClick={() => setFormOpen(true)}
            className="relative z-10 min-h-12 rounded-full px-5 text-base shadow-elev sm:px-8 sm:text-lg"
          >
            <Plus className="h-5 w-5" /> {isAdmin ? "Add Booking" : "Book"}
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 relative z-10">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 self-start">
            <Button variant="outline" size="icon" onClick={() => setAnchor((d) => addWeeks(d, -1))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
            <Button variant="outline" size="icon" onClick={() => setAnchor((d) => addWeeks(d, 1))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={exportCalendar}>
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                className="inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left font-display text-[clamp(1rem,5vw,1.25rem)] text-foreground/90 tabular-nums transition-colors hover:bg-accent/60"
                aria-label="Pick a date"
              >
                <CalendarIcon className="h-4 w-4 opacity-70" />
                {fmtWeekLabel(anchor)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={anchor}
                onSelect={(d) => { if (d) { setAnchor(d); setPickerOpen(false); } }}
                captionLayout="dropdown-buttons"
                fromYear={2000}
                toYear={2100}
                initialFocus
                classNames={{
                  caption_label: "hidden",
                  nav: "hidden",
                  caption_dropdowns: "flex gap-2 justify-center w-full",
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-7">
          {days.map((d, i) => (
            <DayBox
              key={d.toISOString()}
              day={d}
              bookings={bookings}
              events={events}
              onClick={() => setOpenDay(d)}
              index={i}
            />
          ))}
        </div>

        <ReminderSignup />
      </main>

      <DayDetailDialog day={openDay} bookings={bookings} events={events} onClose={() => setOpenDay(null)} />
      <BookingForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        approvedBookings={bookings}
        onSubmitted={load}
        adminMode={isAdmin}
        ensureAdminSession={ensureAdminSession}
      />
    </div>
  );
};

export default Index;
