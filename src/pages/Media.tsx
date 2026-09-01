// ── Media (/media) ─────────────────────────────────────────────────────────────
// Public "Photos & Videos" gallery — a poster wall of events that carry video /
// photo-album / setlist content. Each tile links to the detail page (/media/:eventId)
// where the content lives. The page is public (RLS stays public-read); only the
// "Add media" action is admin-gated. Realtime on the events table keeps the wall
// fresh while an admin edits content elsewhere.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Music, Play, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatLocalizedDate } from "@/lib/date";
import { hasMediaContent, type EventItem } from "@/lib/events";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { loadEvents } from "@/services/events";
import { FadeInImg } from "@/components/FadeInImg";
import { MediaSetlistEditor } from "@/components/MediaSetlistEditor";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const getMediaSortTime = (event: EventItem) => new Date(event.end_date ?? event.event_date).getTime();

const Media = () => {
  const { isAdmin } = useAdmin();
  const { t, language } = useI18n();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorEvent, setEditorEvent] = useState<EventItem | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await loadEvents());
    } catch {
      // Keep the page quiet on transient load failures.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load().finally(() => {
      if (active) setInitialLoading(false);
    });
    const channel = supabase
      .channel("media-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => load())
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Most recent first — media is something you look back on.
  const withContent = useMemo(
    () => events.filter(hasMediaContent).sort((a, b) => getMediaSortTime(b) - getMediaSortTime(a)),
    [events],
  );
  // All events (past + upcoming), most recent first — the tag picker attaches media
  // to any existing event; it never creates one.
  const allByRecency = useMemo(
    () => [...events].sort((a, b) => getMediaSortTime(b) - getMediaSortTime(a)),
    [events],
  );

  const pickEventToTag = (event: EventItem) => {
    setPickerOpen(false);
    setEditorEvent(event);
  };

  return (
    <PageShell className="text-foreground">
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        {/* Title + count + Add Media live together in one frosted chip — the same
            dark-glass language as the tiles' captions and the detail page. Text and
            the CTA flip light automatically via the frost-panel token overrides. */}
        <header className="mb-10 flex flex-col gap-4 rounded-2xl px-5 py-5 shadow-sm frost-panel dark:shadow-none sm:mb-12 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0 space-y-1.5">
            <h1 className="type-page-title text-foreground">{t("media.title")}</h1>
            {/* Reserve the count-line slot while loading (skeleton pill) and once loaded
                with media, so the header chip doesn't resize when the count lands. Only a
                loaded page with no media content collapses the slot. */}
            {(initialLoading || withContent.length > 0) && (
              <p className="text-sm font-medium text-muted-foreground">
                {initialLoading ? (
                  <span className="skeleton-block inline-block h-3.5 w-44 max-w-full rounded-full align-middle" aria-hidden="true" />
                ) : (
                  t("media.countSummary", { count: withContent.length })
                )}
              </p>
            )}
          </div>
          {isAdmin && (
            <Button
              onClick={() => setPickerOpen(true)}
              disabled={events.length === 0}
              className="btn-cta min-h-11 w-full shrink-0 justify-center rounded-full px-5 text-base font-semibold shadow-md transition-[background-color,color,border-color,box-shadow] duration-fast hover:shadow-lg sm:w-auto"
            >
              <Plus className="h-5 w-5" />
              {t("media.addMedia")}
            </Button>
          )}
        </header>

        {initialLoading ? null : withContent.length === 0 ? (
          <div>
            <EmptyMedia />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {withContent.map((event) => (
              <GalleryTile key={event.id} event={event} language={language} />
            ))}
          </div>
        )}
      </main>

      <TagEventDialog
        open={pickerOpen}
        events={allByRecency}
        language={language}
        onClose={() => setPickerOpen(false)}
        onPick={pickEventToTag}
      />

      {editorEvent && (
        <MediaSetlistEditor
          event={editorEvent}
          open={!!editorEvent}
          onClose={() => setEditorEvent(null)}
          onSaved={load}
        />
      )}
    </PageShell>
  );
};

// Tag picker — pick which existing event to attach media to. Never creates events.
const TagEventDialog = ({
  open,
  events,
  language,
  onClose,
  onPick,
}: {
  open: boolean;
  events: EventItem[];
  language: ReturnType<typeof useI18n>["language"];
  onClose: () => void;
  onPick: (event: EventItem) => void;
}) => {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(34rem,calc(100vw-1rem))] border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle>{t("media.tagEventTitle")}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t("media.tagEventDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm font-medium text-muted-foreground">{t("media.tagEventEmpty")}</p>
          ) : (
            events.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onPick(event)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-left transition-colors duration-fast hover:border-interactive-border hover:bg-secondary"
              >
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {event.poster_url ? (
                    <FadeInImg src={event.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-foreground/[0.05]">
                      <Music className="h-5 w-5 text-muted-foreground/40" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{sanitizeDisplayText(event.title)}</span>
                  <span className="block text-xs font-medium tabular-nums text-muted-foreground">
                    {formatLocalizedDate(new Date(event.event_date), language, "MMM d, yyyy", "yyyy 年 M 月 d 日")}
                  </span>
                </span>
                {hasMediaContent(event) && <Play className="h-3.5 w-3.5 shrink-0 fill-current text-muted-foreground" />}
              </button>
            ))
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};

// Gallery tile — poster as art, title + date in a gradient caption, a play badge on
// hover. Distinct from the Events listing's text-below-poster cards.
const GalleryTile = ({ event, language }: { event: EventItem; language: ReturnType<typeof useI18n>["language"] }) => {
  const { t } = useI18n();
  const title = sanitizeDisplayText(event.title);

  return (
    <Link
      to={`/media/${event.id}`}
      className="group relative block overflow-hidden rounded-[1.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="aspect-[4/5] w-full bg-muted">
        {event.poster_url ? (
          <FadeInImg
            src={event.poster_url}
            alt={title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-foreground/[0.05]">
            <Music className="h-10 w-10 text-muted-foreground/40" />
          </div>
        )}
      </div>
      {/* Subtle gradient for depth + a frosted caption box mirroring the detail
          hero and the Landing cards, so the grid reads as the same glass language. */}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <div className="absolute inset-x-2.5 bottom-2.5">
        <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/35 px-3 py-2 frost-box">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold leading-snug text-white">{title}</h3>
            <p className="mt-0.5 text-[0.7rem] font-medium tabular-nums text-white/70">
              {formatLocalizedDate(new Date(event.event_date), language, "MMM d, yyyy", "yyyy 年 M 月 d 日")}
            </p>
          </div>
          <ChevronRight className="h-7 w-7 shrink-0 text-white/85 transition-transform duration-base group-hover:translate-x-0.5" />
        </div>
      </div>
      <span className="btn-overlay absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full opacity-0 transition-opacity duration-base group-hover:opacity-100">
        <Play className="ml-0.5 h-4 w-4 fill-current" />
        <span className="sr-only">{t("media.playVideo")}</span>
      </span>
    </Link>
  );
};

const EmptyMedia = () => {
  const { t } = useI18n();

  return (
    <div className="grid min-h-[18rem] place-items-center rounded-[2rem] border border-border/60 bg-card/70 p-8 text-center dark:bg-card/40">
      <div className="max-w-xs space-y-4">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-foreground/[0.06] text-muted-foreground">
          <Music className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium leading-relaxed text-muted-foreground">{t("media.none")}</p>
      </div>
    </div>
  );
};

export default Media;
