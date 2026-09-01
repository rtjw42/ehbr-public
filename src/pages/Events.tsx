// ── Events (/events) ─────────────────────────────────────────────────────────
// Public upcoming + past gig listing as a minimalist poster wall. Each card links
// to the unified event detail page (/events/:id). Realtime on the events table;
// admins create/edit/delete via EventForm (event basics only — media/setlist are
// managed on the detail page). Writes go through the events service.
//
// This page is the reference for the app's editorial direction: a bespoke airy
// header (no bordered bar / separator line) and quiet eyebrow section labels.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { isPast } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ListFilter, MapPin, Music, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogBody, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { formatDateAtTime, formatLocalizedDate } from "@/lib/date";
import { hasMediaContent, type EventItem } from "@/lib/events";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { crossfadeTransition } from "@/lib/motion";
import { deleteEvent, loadEvents } from "@/services/events";
import { FadeInImg } from "@/components/FadeInImg";
import { PageShell } from "@/components/PageShell";

const EventForm = lazy(() => import("@/components/EventForm").then((module) => ({ default: module.EventForm })));

const getEventSortTime = (event: EventItem) => new Date(event.end_date ?? event.event_date).getTime();

const Events = () => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const { showAdminControls, ensureAdminSession } = useAdmin();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventItem | null>(null);
  const [infoEvent, setInfoEvent] = useState<EventItem | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [pastYear, setPastYear] = useState<number | "all">("all");
  const { t, language } = useI18n();

  const load = useCallback(async () => {
    try {
      setEvents(await loadEvents());
    } catch {
      // Keep the public events page quiet on transient load failures.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load().finally(() => {
      if (active) setInitialLoading(false);
    });
    const ch = supabase
      .channel("events-public")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const openNewEvent = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEditEvent = (event: EventItem) => {
    setEditing(event);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    if (deletingEventId) return;
    if (!(await ensureAdminSession())) return;
    const target = pendingDelete;
    setDeletingEventId(target.id);
    try {
      await deleteEvent(target.id);
      toast.success(t("common.deleted"));
      setPendingDelete(null);
      await load();
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : error instanceof Error ? error.message : t("common.couldNotDelete"));
      await load();
    } finally {
      setDeletingEventId(null);
    }
  };

  const upcoming = useMemo(
    () => events
      .filter((event) => !isPast(new Date(event.end_date ?? event.event_date)))
      .sort((a, b) => getEventSortTime(a) - getEventSortTime(b)),
    [events],
  );
  const past = useMemo(
    () => events
      .filter((event) => isPast(new Date(event.end_date ?? event.event_date)))
      .sort((a, b) => getEventSortTime(b) - getEventSortTime(a)),
    [events],
  );
  // Past gigs accumulate, so they get a year filter. Years are derived from the data
  // (most recent first); "all" is the default.
  const pastYears = useMemo(
    () => Array.from(new Set(past.map((event) => new Date(event.event_date).getFullYear()))).sort((a, b) => b - a),
    [past],
  );
  const filteredPast = useMemo(
    () => (pastYear === "all" ? past : past.filter((event) => new Date(event.event_date).getFullYear() === pastYear)),
    [past, pastYear],
  );

  return (
    <PageShell className="text-foreground">
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        {/* Title + count + New event in one frosted dark-glass chip, matching /media. */}
        <header className="mb-10 flex flex-col gap-4 rounded-2xl px-5 py-5 shadow-sm frost-panel dark:shadow-none sm:mb-12 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0 space-y-1.5">
            <h1 className="type-page-title text-foreground">{t("events.title")}</h1>
            {/* Reserve the count-line slot: render the <p> while loading (a skeleton
                pill inside it) AND once loaded with data, so the header chip keeps the
                same height when the fetched count lands — no resize. Only a genuinely
                empty page (loaded, no events) collapses the slot. */}
            {(initialLoading || events.length > 0) && (
              <p className="text-sm font-medium text-muted-foreground">
                {initialLoading ? (
                  <span className="skeleton-block inline-block h-3.5 w-44 max-w-full rounded-full align-middle" aria-hidden="true" />
                ) : (
                  t("events.countSummary", { upcoming: upcoming.length, past: past.length })
                )}
              </p>
            )}
          </div>
          {showAdminControls && (
            <Button
              onClick={openNewEvent}
              className="btn-cta min-h-11 w-full shrink-0 justify-center rounded-full px-5 text-base font-semibold shadow-md transition-[background-color,color,border-color,box-shadow] duration-fast hover:shadow-lg sm:w-auto"
            >
              <Plus className="h-5 w-5" />
              {t("events.newEvent")}
            </Button>
          )}
        </header>

        {/* Print-only event list — on-screen cards are print:hidden. */}
        <div className="hidden print:block">
          <h1 className="mb-3 text-xl font-bold">{t("events.title")}</h1>
          <div className="space-y-2">
            {[...upcoming, ...past].map((ev) => (
              <div key={ev.id} className="break-inside-avoid border-b border-black/30 pb-1.5">
                <div className="text-sm font-semibold">{sanitizeDisplayText(ev.title)}</div>
                <div className="text-sm tabular-nums">
                  {formatDateAtTime(new Date(ev.event_date), language, "EEE, MMM d", "M 月 d 日 EEE")}
                  {ev.location ? ` · ${sanitizeDisplayText(ev.location)}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="print:hidden">
          <AnimatePresence mode="wait" initial={false}>
            {initialLoading ? null : events.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={crossfadeTransition}>
                <EmptyEvents />
              </motion.div>
            ) : (
              <motion.div key="content" className="space-y-10 sm:space-y-12">
                {upcoming.length > 0 && (
                  <EventSection
                    label={t("events.upcomingSection")}
                    events={upcoming}
                    prominent
                    pageSize={4}
                    isAdmin={showAdminControls}
                    language={language}
                    onOpenInfo={setInfoEvent}
                    onEdit={openEditEvent}
                    onDelete={setPendingDelete}
                  />
                )}
                {past.length > 0 && (
                  <EventSection
                    // Remount on filter change so the pager window resets to the first page.
                    key={`past-${pastYear}`}
                    label={t("events.pastSection")}
                    events={filteredPast}
                    prominent={false}
                    pageSize={6}
                    yearFilter={pastYears.length > 1 ? { years: pastYears, value: pastYear, onChange: setPastYear } : undefined}
                    isAdmin={showAdminControls}
                    language={language}
                    onOpenInfo={setInfoEvent}
                    onEdit={openEditEvent}
                    onDelete={setPendingDelete}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <EventInfoDialog event={infoEvent} language={language} onClose={() => setInfoEvent(null)} />

      <Suspense fallback={null}>
        <EventForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} onSaved={load} />
      </Suspense>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("events.deleteTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {t("events.deleteDescription", { title: sanitizeDisplayText(pendingDelete?.title) })}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={!!deletingEventId} onClick={handleDelete}>{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
};

const EmptyEvents = () => {
  const { t } = useI18n();

  return (
    <div className="grid min-h-[18rem] place-items-center rounded-[2rem] border border-border/60 bg-card/70 p-8 text-center dark:bg-card/40">
      <div className="max-w-xs space-y-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-foreground/[0.06] text-muted-foreground">
          <Music className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium leading-relaxed text-muted-foreground">{t("events.none")}</p>
      </div>
    </div>
  );
};

type YearFilterProps = {
  years: number[];
  value: number | "all";
  onChange: (value: number | "all") => void;
};

const EventSection = ({
  label,
  events,
  prominent,
  pageSize,
  yearFilter,
  isAdmin,
  language,
  onOpenInfo,
  onEdit,
  onDelete,
}: {
  label: string;
  events: EventItem[];
  prominent: boolean;
  // Past this many cards the section paginates with chevrons. The window slides by
  // a full page but clamps at the end (7 items page 2 = items 2–7, not a lone card),
  // so the visible count — and the grid height — never changes between pages.
  pageSize: number;
  yearFilter?: YearFilterProps;
  isAdmin: boolean;
  language: ReturnType<typeof useI18n>["language"];
  onOpenInfo: (event: EventItem) => void;
  onEdit: (event: EventItem) => void;
  onDelete: (event: EventItem) => void;
}) => {
  const { t } = useI18n();
  const [windowStart, setWindowStart] = useState(0);

  const paginated = events.length > pageSize;
  // Derived clamp (not an effect): if the list shrinks under the current offset —
  // realtime delete, year filter — the window snaps back without a wrong frame.
  const maxStart = Math.max(0, events.length - pageSize);
  const start = Math.min(windowStart, maxStart);
  const visible = paginated ? events.slice(start, start + pageSize) : events;
  const step = (direction: 1 | -1) =>
    setWindowStart(Math.min(Math.max(0, start + direction * pageSize), maxStart));

  const pagerButtonClass =
    "grid h-10 w-10 shrink-0 place-items-center rounded-full shadow-sm frost-panel transition-[background-color,opacity] duration-fast hover:bg-foreground/10 disabled:pointer-events-none disabled:opacity-40 dark:shadow-none";

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2.5 rounded-full px-4 py-2 shadow-sm frost-panel dark:shadow-none">
          <span className="text-sm font-semibold text-foreground sm:text-base">{label}</span>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">{events.length}</span>
        </h2>
        {yearFilter && <YearFilter {...yearFilter} />}
      </div>
      {/* Upcoming = larger poster cards; past = a denser grid. */}
      <div
        className={
          prominent
            ? "grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4"
            : "grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-5 lg:grid-cols-6"
        }
      >
        {visible.map((event) => (
          <div key={event.id} className="h-full">
            <EventPosterCard event={event} compact={!prominent} isAdmin={isAdmin} language={language} onOpenInfo={() => onOpenInfo(event)} onEdit={() => onEdit(event)} onDelete={() => onDelete(event)} />
          </div>
        ))}
      </div>
      {paginated && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button type="button" onClick={() => step(-1)} disabled={start === 0} aria-label={t("events.prevPage")} className={pagerButtonClass}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="rounded-full px-3.5 py-1.5 text-xs font-semibold tabular-nums text-muted-foreground shadow-sm frost-panel dark:shadow-none">
            {t("events.pageStatus", { from: start + 1, to: start + visible.length, total: events.length })}
          </span>
          <button type="button" onClick={() => step(1)} disabled={start >= maxStart} aria-label={t("events.nextPage")} className={pagerButtonClass}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </section>
  );
};

// Year filter for the Past section — a compact frosted pill matching the heading.
const YearFilter = ({ years, value, onChange }: YearFilterProps) => {
  const { t } = useI18n();

  return (
    <Select value={String(value)} onValueChange={(next) => onChange(next === "all" ? "all" : Number(next))}>
      <SelectTrigger
        aria-label={t("events.filterByYear")}
        className="h-9 w-auto gap-2 rounded-full px-4 text-sm font-semibold tabular-nums text-foreground shadow-sm frost-panel dark:shadow-none"
      >
        <ListFilter className="h-4 w-4 shrink-0 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("events.allYears")}</SelectItem>
        {years.map((year) => (
          <SelectItem key={year} value={String(year)}>{year}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const EventPosterCard = ({
  event,
  compact,
  isAdmin,
  language,
  onOpenInfo,
  onEdit,
  onDelete,
}: {
  event: EventItem;
  compact: boolean;
  isAdmin: boolean;
  language: ReturnType<typeof useI18n>["language"];
  onOpenInfo: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const { t } = useI18n();
  const title = sanitizeDisplayText(event.title);
  const location = sanitizeDisplayText(event.location);
  const showMediaBadge = hasMediaContent(event);
  const dateLabel = formatLocalizedDate(new Date(event.event_date), language, "MMM d, yyyy", "yyyy 年 M 月 d 日");

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[1.25rem] shadow-sm frost-panel dark:shadow-none">
      <button
        type="button"
        onClick={onOpenInfo}
        className="flex h-full w-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="relative aspect-square w-full shrink-0 bg-muted">
          {event.poster_url ? (
            <FadeInImg
              src={event.poster_url}
              alt={title}
              className="h-full w-full object-cover"
              loading={compact ? "lazy" : "eager"}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-foreground/[0.05]">
              <Music className={compact ? "h-8 w-8 text-muted-foreground/40" : "h-12 w-12 text-muted-foreground/40"} />
            </div>
          )}
          {showMediaBadge && (
            <span className="btn-overlay absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide">
              <Play className="h-2.5 w-2.5 fill-current" />
              {t("events.viewMedia")}
            </span>
          )}
        </div>
        {compact ? (
          <div className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
            <p className="text-[0.68rem] font-semibold uppercase tracking-wide tabular-nums text-muted-foreground">{dateLabel}</p>
            <p className="truncate text-sm font-semibold leading-snug text-foreground">{title}</p>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-3 px-3.5 py-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide tabular-nums text-muted-foreground">{dateLabel}</p>
              <p className="type-card-title truncate text-foreground">{title}</p>
              {location && <p className="truncate text-sm font-medium text-muted-foreground">{location}</p>}
            </div>
            <ChevronRight className="h-9 w-9 shrink-0 text-muted-foreground transition-transform duration-base group-hover:translate-x-0.5" />
          </div>
        )}
      </button>

      {isAdmin && (
        <div className="absolute right-2 top-2 flex gap-1.5">
          <CardAdminButton label={t("common.edit")} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </CardAdminButton>
          <CardAdminButton label={t("common.delete")} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </CardAdminButton>
        </div>
      )}
    </article>
  );
};

// Admin action over a poster corner — sits above the card link, suppresses the
// navigation, and stays tappable on touch (no hover dependency).
const CardAdminButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }}
    className="btn-overlay grid h-7 w-7 place-items-center rounded-full transition-colors duration-fast"
  >
    {children}
  </button>
);

// Event info popup — opened from a card. Bigger poster + full info; when the event
// has media, a "View pics & vids" button routes to /media/:eventId (now public).
const EventInfoDialog = ({
  event,
  language,
  onClose,
}: {
  event: EventItem | null;
  language: ReturnType<typeof useI18n>["language"];
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const title = sanitizeDisplayText(event?.title);
  const location = sanitizeDisplayText(event?.location);
  const description = sanitizeDisplayText(event?.description);
  const showMedia = !!event && hasMediaContent(event);

  return (
    <Dialog open={!!event} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(34rem,calc(100vw-1rem))] border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {event && (
            <>
              <div className="overflow-hidden rounded-2xl bg-muted shadow-sm dark:border dark:border-border dark:shadow-none">
                <div className="aspect-square w-full">
                  {event.poster_url ? (
                    <FadeInImg src={event.poster_url} alt={title} className="h-full w-full object-cover" loading="eager" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-foreground/[0.05]">
                      <Music className="h-14 w-14 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium tabular-nums text-muted-foreground">
                  <CalendarIcon className="h-4 w-4 shrink-0" />
                  {formatDateAtTime(new Date(event.event_date), language, "EEE, MMM d, yyyy", "yyyy 年 M 月 d 日 EEE")}
                </p>
                {location && (
                  <p className="flex items-start gap-2 text-sm font-medium text-muted-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">{location}</span>
                  </p>
                )}
                {description && (
                  <p className="whitespace-pre-wrap pt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
                )}
              </div>
            </>
          )}
        </DialogBody>
        {showMedia && (
          <DialogFooter>
            <Button
              onClick={() => {
                const targetId = event.id;
                onClose();
                navigate(`/media/${targetId}`);
              }}
              className="w-full rounded-full border-0 bg-interactive text-interactive-text shadow-md transition-[background-color,box-shadow,transform] duration-fast hover:opacity-90 sm:w-auto"
            >
              <Play className="h-4 w-4 fill-current" />
              {t("media.viewMedia")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Events;
