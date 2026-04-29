import { useEffect, useRef, useState } from "react";
import { format, isToday } from "date-fns";
import { Booking, bookingsForDay } from "@/lib/booking-utils";
import { EventItem, eventsForDay } from "@/lib/events";
import { BookingChip } from "./BookingChip";
import { Music } from "lucide-react";

interface Props {
  day: Date;
  bookings: Booking[];
  events?: EventItem[];
  onClick: () => void;
  index?: number;
}

export const DayBox = ({ day, bookings, events = [], onClick, index = 0 }: Props) => {
  const items = bookingsForDay(bookings, day);
  const dayEvents = eventsForDay(events, day);
  const today = isToday(day);
  const overflow = items.length > 3;
  const listRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (overflow && listRef.current) {
      setDuration(Math.max(8, items.length * 2.5));
    }
  }, [overflow, items.length]);

  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${index * 50}ms` }}
      className={`group relative flex min-h-[clamp(10rem,42vw,13.75rem)] flex-col rounded-2xl border bg-card p-3 text-left shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-elev sm:p-4 animate-day-in ${
        today ? "ring-2 ring-ring/40" : ""
      }`}
      aria-label={`${format(day, "EEEE, MMMM d")}, ${items.length} bookings, ${dayEvents.length} events`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[clamp(0.625rem,2vw,0.7rem)] uppercase tracking-widest text-muted-foreground font-medium">
            {format(day, "EEE")}
          </div>
          <div className={`font-display text-[clamp(2.25rem,9vw,3rem)] leading-none tracking-tight ${today ? "text-primary" : "text-foreground"}`}>
            {format(day, "d")}
          </div>
        </div>
        {items.length > 0 && (
          <span className="text-[clamp(0.625rem,2vw,0.7rem)] text-muted-foreground">
            {items.length} {items.length === 1 ? "booking" : "bookings"}
          </span>
        )}
      </div>

      {/* Event banners */}
      {dayEvents.length > 0 && (
        <div className="space-y-1 mb-2">
          {dayEvents.map((ev) => (
            <div
              key={ev.id}
              className="relative overflow-hidden rounded-lg border border-primary/40 bg-gradient-to-r from-primary/15 to-accent/15 px-2 py-1.5 flex items-center gap-2"
              title={ev.title}
            >
              {ev.poster_url ? (
                <img src={ev.poster_url} alt="" className="h-7 w-7 rounded object-cover shrink-0" />
              ) : (
                <div className="h-7 w-7 rounded bg-primary/20 flex items-center justify-center shrink-0">
                  <Music className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[clamp(0.68rem,2vw,0.75rem)] font-semibold leading-tight">{ev.title}</div>
                <div className="truncate text-[clamp(0.6rem,1.8vw,0.68rem)] text-muted-foreground tabular-nums">
                  {format(new Date(ev.event_date), "HH:mm")}
                  {ev.location && <> · <span className="truncate">{ev.location}</span></>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground/60 italic">
            free
          </div>
        ) : overflow ? (
          <div
            ref={listRef}
            className="animate-marquee-y space-y-1.5"
            style={{ animationDuration: `${duration}s` }}
          >
            {[...items, ...items].map((it, idx) => (
              <BookingChip
                key={`${it.booking.id}-${idx}`}
                booking={it.booking}
                day={day}
                isContinued={it.isContinued}
                compact
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.map((it) => (
              <BookingChip
                key={it.booking.id}
                booking={it.booking}
                day={day}
                isContinued={it.isContinued}
              />
            ))}
          </div>
        )}
      </div>
    </button>
  );
};
