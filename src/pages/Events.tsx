import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EventItem } from "@/lib/events";
import { format, isPast } from "date-fns";
import { Button } from "@/components/ui/button";
import { MapPin, Plus, Pencil, Trash2, Calendar as CalendarIcon, Music } from "lucide-react";
import { EventForm } from "@/components/EventForm";
import { toast } from "sonner";
import { useAdmin } from "@/hooks/useAdmin";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const Events = () => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const { isAdmin, ensureAdminSession } = useAdmin();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventItem | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("event_date", { ascending: true });
    if (!error && data) setEvents(data as EventItem[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("events-public")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    if (!(await ensureAdminSession())) return;
    const { error } = await supabase.from("events").delete().eq("id", pendingDelete.id);
    if (error) toast.error(error.message);
    else toast.success("Event deleted");
    setPendingDelete(null);
    load();
  };

  const upcoming = events.filter((e) => !isPast(new Date(e.end_date ?? e.event_date)));
  const past = events.filter((e) => isPast(new Date(e.end_date ?? e.event_date)));

  return (
    <div className="app-page-bg min-h-screen relative overflow-hidden page-transition">
      {/* Stage spotlights background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-[12%] left-1/4 h-[clamp(16rem,45vw,31rem)] w-[clamp(16rem,45vw,31rem)] rounded-full bg-[hsl(15_70%_55%/0.15)] blur-3xl animate-float-slow" />
        <div className="absolute -right-[12%] top-1/2 h-[clamp(18rem,52vw,37rem)] w-[clamp(18rem,52vw,37rem)] rounded-full bg-[hsl(40_80%_55%/0.12)] blur-3xl animate-float-slower" />
        <div className="absolute -bottom-[12%] left-1/3 h-[clamp(15rem,42vw,28rem)] w-[clamp(15rem,42vw,28rem)] rounded-full bg-[hsl(280_50%_50%/0.10)] blur-3xl animate-float-slow" />
      </div>

      <header className="border-b bg-card/60 backdrop-blur relative z-20">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center gap-3 min-w-0 hero-enter">
            <div className="min-w-0">
              <h1 className="font-display text-[clamp(2.25rem,10vw,4rem)] text-primary leading-none tracking-tight">Upcoming Gigs</h1>
            </div>
          </div>
          {isAdmin && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="admin-reveal shadow-soft">
              <Plus className="h-4 w-4" /> New event
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14 relative z-10">
        {events.length === 0 ? (
          <div className="text-center py-20">
            <Music className="h-16 w-16 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground italic">No events scheduled yet.</p>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section className="mb-16">
                <h2 className="mb-8 font-display text-[clamp(1.5rem,6vw,2rem)] text-foreground/90">On the turntable</h2>
                <div className="space-y-14 sm:space-y-20 lg:space-y-28">
                  {upcoming.map((ev, i) => (
                    <ScrollVinylRow
                      key={ev.id} event={ev} index={i} isAdmin={isAdmin}
                      onEdit={() => { setEditing(ev); setFormOpen(true); }}
                      onDelete={() => setPendingDelete(ev)}
                    />
                  ))}
                </div>
              </section>
            )}
            {past.length > 0 && (
              <section className="opacity-70">
                <h2 className="mb-8 font-display text-[clamp(1.5rem,6vw,2rem)] text-muted-foreground">B-sides (past)</h2>
                <div className="space-y-14 sm:space-y-20 lg:space-y-28">
                  {past.map((ev, i) => (
                    <ScrollVinylRow
                      key={ev.id} event={ev} index={i} isAdmin={isAdmin} faded
                      onEdit={() => { setEditing(ev); setFormOpen(true); }}
                      onDelete={() => setPendingDelete(ev)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <EventForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} onSaved={load} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.title}" will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

interface RowProps {
  event: EventItem;
  index: number;
  isAdmin: boolean;
  faded?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const ScrollVinylRow = ({ event, index, isAdmin, faded, onEdit, onDelete }: RowProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const fromLeft = index % 2 === 0;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  const date = new Date(event.event_date);

  return (
    <article
      ref={ref}
      className={`group grid grid-cols-1 items-start gap-6 md:grid-cols-2 md:gap-12 lg:gap-16 ${faded ? "opacity-70" : ""}`}
    >
      {/* Visual side: poster slots into view on scroll */}
      <div
        className={`relative mx-auto aspect-square w-full max-w-[min(100%,28rem)] transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] md:mx-0 ${
          fromLeft ? "md:order-1 md:mr-auto" : "md:order-2 md:ml-auto"
        }`}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible
            ? "translateX(0) scale(1)"
            : `translateX(${fromLeft ? "-12%" : "12%"}) scale(0.94)`,
        }}
      >
        {/* Poster card */}
        <div className="absolute inset-0 rounded-md bg-card border shadow-elev overflow-hidden z-10 transition-transform duration-500 group-hover:-rotate-[1.5deg]">
          {event.poster_url ? (
            <img src={event.poster_url} alt={event.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/20">
              <Music className="h-[clamp(4rem,18vw,6rem)] w-[clamp(4rem,18vw,6rem)] text-foreground/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <div className="absolute inset-x-4 bottom-4 text-white">
            <h3 className="font-display text-[clamp(1.75rem,8vw,2.25rem)] leading-tight drop-shadow-lg">{event.title}</h3>
          </div>
        </div>
      </div>

      {/* Text side */}
      <div
        className={`mx-auto flex w-full max-w-[min(100%,28rem)] min-w-0 flex-col gap-4 text-left transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] delay-150 md:mx-0 ${
          fromLeft ? "md:order-2 md:mr-auto md:items-start" : "md:order-1 md:ml-auto md:items-end md:text-right"
        }`}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible
            ? "translateX(0)"
            : `translateX(${fromLeft ? "10%" : "-10%"})`,
        }}
      >
        <div className={`flex max-w-full items-center gap-2 text-sm text-foreground/80 ${fromLeft ? "" : "md:justify-end"}`}>
          <CalendarIcon className="h-4 w-4 text-primary shrink-0" />
          <span className="min-w-0 break-words font-medium tabular-nums uppercase tracking-wider">{format(date, "EEE, MMM d · HH:mm")}</span>
        </div>
        <h3 className="max-w-[12ch] break-words font-display text-[clamp(2.25rem,10vw,4rem)] text-foreground leading-tight sm:max-w-[14ch]">{event.title}</h3>
        {event.location && (
          <div className={`flex max-w-prose items-start gap-2 text-base text-muted-foreground ${fromLeft ? "" : "md:justify-end"}`}>
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{event.location}</span>
          </div>
        )}
        {event.description && (
          <p className="max-w-full text-base leading-relaxed text-foreground/70">{event.description}</p>
        )}
        {isAdmin && (
          <div className={`admin-reveal flex flex-wrap gap-2 pt-3 ${fromLeft ? "" : "md:justify-end"}`}>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button size="sm" variant="outline" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}
      </div>
    </article>
  );
};

export default Events;
