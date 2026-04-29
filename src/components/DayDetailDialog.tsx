import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Booking, bookingsForDay, bookingBg, bookingBorder, bookingDot, fmtTimeRange } from "@/lib/booking-utils";
import { EventItem, eventsForDay } from "@/lib/events";
import { MapPin, Music } from "lucide-react";

interface Props {
  day: Date | null;
  bookings: Booking[];
  events?: EventItem[];
  onClose: () => void;
}

export const DayDetailDialog = ({ day, bookings, events = [], onClose }: Props) => {
  const items = day ? bookingsForDay(bookings, day) : [];
  const dayEvents = day ? eventsForDay(events, day) : [];
  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[min(85svh,42rem)] w-[min(calc(100vw-1rem),calc(100%-2rem))] max-w-[min(28rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-[clamp(1.5rem,6vw,2rem)]">
            {day ? format(day, "EEEE, MMMM d") : ""}
          </DialogTitle>
        </DialogHeader>

        {dayEvents.length > 0 && (
          <div className="space-y-3 mb-2">
            <h3 className="text-[clamp(0.625rem,2vw,0.7rem)] uppercase tracking-widest text-muted-foreground font-bold">Events</h3>
            {dayEvents.map((ev) => (
              <div
                key={ev.id}
                className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 to-accent/10 overflow-hidden"
              >
                {ev.poster_url && (
                  <img src={ev.poster_url} alt={ev.title} className="w-full h-32 object-cover" />
                )}
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <Music className="h-4 w-4 text-primary" />
                    <div className="font-semibold">{ev.title}</div>
                  </div>
                  <div className="text-sm text-foreground/80 mt-1 tabular-nums">
                    {format(new Date(ev.event_date), "HH:mm")}
                    {ev.end_date && ` – ${format(new Date(ev.end_date), "HH:mm")}`}
                  </div>
                  {ev.location && (
                    <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {ev.location}
                    </div>
                  )}
                  {ev.description && (
                    <p className="text-sm text-foreground/70 mt-2">{ev.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {dayEvents.length > 0 && items.length > 0 && (
            <h3 className="text-[clamp(0.625rem,2vw,0.7rem)] uppercase tracking-widest text-muted-foreground font-bold pt-2">Bookings</h3>
          )}
          {items.length === 0 && dayEvents.length === 0 && (
            <p className="text-sm text-muted-foreground italic py-6 text-center">
              No bookings on this day.
            </p>
          )}
          {items.map(({ booking, isContinued }) => (
            <div
              key={booking.id}
              className="rounded-xl border p-3"
              style={{ backgroundColor: bookingBg(booking), borderColor: bookingBorder(booking) }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bookingDot(booking) }} />
                <div className="min-w-0 truncate font-semibold">
                  {booking.name}
                  {isContinued && <span className="opacity-60 font-normal"> (cont.)</span>}
                </div>
              </div>
              <div className="mt-1 break-words text-sm text-foreground/80 tabular-nums">
                {fmtTimeRange(booking, day!)} ·{" "}
                <a
                  href={`https://t.me/${booking.contact.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-primary"
                >
                  @{booking.contact.replace(/^@/, "")}
                </a>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
