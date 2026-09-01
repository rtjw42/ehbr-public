// ── Media detail (/media/:eventId) ──────────────────────────────────────────────
// Public media page for one event: a full-width thumbnail hero (title/date/
// location in a frosted box, like the Landing cards), then a collapsible setlist on
// the left and videos + photo-album links on the right (stacked on mobile in the
// order hero → description → setlist → videos → pics). Content lives as jsonb on the event
// row; this is the only place pics/vids/setlist are shown. The page is public (RLS
// stays public-read); only the inline edit affordance is admin-gated.
// Realtime on the event row keeps it fresh while editing.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Images, MapPin, Music, Pencil, Play, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateAtTime } from "@/lib/date";
import { type EventItem, type SetlistEntry, SETLIST_PLATFORMS, type SetlistPlatform } from "@/lib/events";
import { parseYouTubeId, youTubeEmbedUrl, youTubeThumbnailUrl } from "@/lib/media";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { loadEventById } from "@/services/events";
import { AppleMusicIcon, SpotifyIcon, YouTubeIcon } from "@/components/BrandIcons";
import { FadeInImg } from "@/components/FadeInImg";
import { MediaSetlistEditor } from "@/components/MediaSetlistEditor";
import { PageShell } from "@/components/PageShell";
import { cn } from "@/lib/utils";
import { Collapse } from "@/components/ui/collapse";

const PLATFORM_LABELS: Record<SetlistPlatform, string> = {
  spotify: "Spotify",
  apple: "Apple Music",
  youtube: "YouTube",
};
const PLATFORM_ICONS: Record<SetlistPlatform, ({ className }: { className?: string }) => JSX.Element> = {
  spotify: SpotifyIcon,
  apple: AppleMusicIcon,
  youtube: YouTubeIcon,
};

// Large, readable section heading (Videos / Photos / Setlist).
const SECTION_LABEL_CLASS = "text-lg font-semibold text-foreground sm:text-xl";

const MediaDetail = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const { showAdminControls } = useAdmin();
  const { t, language } = useI18n();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  // Only the setlist collapses (closed by default); videos + photos stay open.
  const [setlistOpen, setSetlistOpen] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      setEvent(await loadEventById(eventId));
    } catch {
      setEvent(null);
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    setLoading(true);
    void load().finally(() => {
      if (active) setLoading(false);
    });
    const channel = supabase
      .channel(`media-event-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `id=eq.${eventId}` }, () => load())
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [eventId, load]);

  const videos = useMemo(() => event?.media.filter((m) => m.type === "youtube") ?? [], [event]);
  const albums = useMemo(() => event?.media.filter((m) => m.type === "photo_album") ?? [], [event]);

  if (loading) return <PageShell className="text-foreground"><span aria-hidden="true" /></PageShell>;

  // A deleted event / bad id resolves to nothing — send the viewer back to the gallery.
  if (!event) return <Navigate to="/media" replace />;

  const title = sanitizeDisplayText(event.title);
  const location = sanitizeDisplayText(event.location);
  const description = sanitizeDisplayText(event.description);
  const hasSetlist = event.setlist.length > 0;
  const hasContent = videos.length > 0 || albums.length > 0 || hasSetlist;
  // The two panels below the hero. When only one has content it spans full width
  // (no empty 22rem gutter); when both exist they sit side by side on desktop.
  const hasLeftPanel = !!description || hasSetlist;
  const hasRightPanel = videos.length > 0 || albums.length > 0;

  return (
    <PageShell className="text-foreground">
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {/* Full-width thumbnail hero — frosted title/date box pinned bottom-left,
            mirroring the Landing cards. Admin edit button sits top-right. */}
        <div className="relative overflow-hidden rounded-[1.5rem] shadow-lg dark:shadow-none">
          <div className="aspect-[16/10] w-full bg-muted sm:aspect-[21/9]">
            {event.poster_url ? (
              <FadeInImg src={event.poster_url} alt={title} className="h-full w-full object-cover object-center" loading="eager" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-foreground/[0.05]">
                <Music className="h-14 w-14 text-muted-foreground/40" />
              </div>
            )}
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/25" />
          {showAdminControls && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="btn-overlay absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-fast"
            >
              {hasContent ? <Pencil className="h-4 w-4" /> : <Plus className="h-5 w-5" />}
              {hasContent ? t("media.editContent") : t("media.addContent")}
            </button>
          )}
          <div className="absolute inset-x-4 bottom-4 max-w-[calc(100%-2rem)] sm:inset-x-7 sm:bottom-7 sm:max-w-[min(36rem,calc(100%-3.5rem))]">
            <div className="rounded-xl border border-white/15 bg-black/35 px-4 py-3 frost-box">
              <h1 className="type-card-title break-words text-white [text-shadow:0_2px_16px_rgba(0,0,0,0.55)]">{title}</h1>
              <p className="mt-1.5 text-sm font-semibold tabular-nums text-white/85">
                {formatDateAtTime(new Date(event.event_date), language, "EEE, MMM d, yyyy", "yyyy 年 M 月 d 日 EEE")}
              </p>
              {location && (
                <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-white/70">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">{location}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Below the hero: one frosted panel for "About + Setlist" (left), one for
            "Videos + Photos" (right). Top-aligned so the shorter panel doesn't grow
            empty space. On mobile they stack: About → Setlist → Videos → Photos.
            When only one panel has content it spans full width (no empty gutter). */}
        {(hasLeftPanel || hasRightPanel) && (
          <div
            className={cn(
              "mt-10",
              hasLeftPanel && hasRightPanel && "lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-6",
            )}
          >
            {/* LEFT panel: "About" + collapsible setlist, divided by a hairline. */}
            {hasLeftPanel && (
              <div className="min-w-0 overflow-hidden rounded-2xl shadow-sm frost-panel dark:shadow-none">
                {description && (
                  <section className="px-5 py-5">
                    <h2 className={SECTION_LABEL_CLASS}>{t("media.about")}</h2>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{description}</p>
                  </section>
                )}
                {description && hasSetlist && <div className="border-t border-foreground/10" />}
                {hasSetlist && (
                  <CollapsibleSection label={t("media.setlist")} open={setlistOpen} onToggle={() => setSetlistOpen((o) => !o)}>
                    <TypedSetlist setlist={event.setlist} />
                  </CollapsibleSection>
                )}
              </div>
            )}

            {/* RIGHT panel: videos + photos, each a collapsible dropdown matching the
                setlist, in one frosted surface. */}
            {hasRightPanel && (
              <div className={cn("min-w-0 space-y-8 rounded-2xl px-5 py-5 shadow-sm frost-panel dark:shadow-none", hasLeftPanel && "mt-6 lg:mt-0")}>
                {videos.length > 0 && (
                  <section className="space-y-4">
                    <h2 className={SECTION_LABEL_CLASS}>{t("media.videos")}</h2>
                    <VideoCarousel urls={videos.map((video) => video.url)} />
                  </section>
                )}
                {albums.length > 0 && (
                  <section className="space-y-4">
                    <h2 className={SECTION_LABEL_CLASS}>{t("media.photos")}</h2>
                    <div className="flex flex-col gap-2.5">
                      {albums.map((album, index) => {
                        const name = album.title?.trim() ? sanitizeDisplayText(album.title) : t("media.openPhotos");
                        return (
                          <a
                            key={`${album.url}-${index}`}
                            href={album.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-3 rounded-xl border border-foreground/20 bg-foreground/[0.07] px-4 py-3 text-sm font-semibold text-foreground transition-[background-color,color,border-color] duration-fast ease-standard hover:border-interactive-border hover:bg-interactive hover:text-interactive-text"
                          >
                            <Images className="h-4 w-4 shrink-0 text-foreground/70 transition-colors duration-fast group-hover:text-interactive-text" />
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-foreground/50 transition-colors duration-fast group-hover:text-interactive-text" />
                          </a>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {showAdminControls && (
        <MediaSetlistEditor event={event} open={editorOpen} onClose={() => setEditorOpen(false)} onSaved={load} />
      )}
    </PageShell>
  );
};

// Shared collapsible section — large label + chevron header, body via <Collapse>
// (grid-rows height glide). Used for setlist, videos, and photos so the three
// dropdowns stay identical.
const CollapsibleSection = ({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) => (
  <section>
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
    >
      <span className={SECTION_LABEL_CLASS}>{label}</span>
      <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-base", open && "rotate-180")} />
    </button>
    <Collapse show={open} className="px-5 pb-5">{children}</Collapse>
  </section>
);

// Typed-out, rough setlist — monospace list with dashed rules. Sits inside the
// setlist frost-panel, so it carries no panel of its own.
const TypedSetlist = ({ setlist }: { setlist: SetlistEntry[] }) => {
  const { t } = useI18n();

  return (
    <div>
      <ol className="font-mono text-sm leading-relaxed text-foreground">
        {setlist.map((song, index) => {
          const songTitle = sanitizeDisplayText(song.title);
          const links = SETLIST_PLATFORMS.filter((platform) => song[platform]);
          return (
            <li key={index} className="flex items-baseline gap-3 border-b border-dashed border-border/60 py-1.5 last:border-0">
              <span className="shrink-0 tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 break-words">{songTitle}</span>
              {links.length > 0 && (
                <span className="flex shrink-0 items-center gap-2">
                  {links.map((platform) => {
                    const Icon = PLATFORM_ICONS[platform];
                    return (
                      <a
                        key={platform}
                        href={song[platform]}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("media.listenOn", { platform: PLATFORM_LABELS[platform] })}
                        className="text-muted-foreground transition-colors duration-fast hover:text-foreground"
                      >
                        <Icon className="h-[0.95rem] w-[0.95rem]" />
                      </a>
                    );
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

// Videos carousel — one player at a time with arrow nav + dot progress. A single
// video renders bare. Rendering only the active facade means navigating away from a
// playing video unmounts its iframe, which stops playback.
const VideoCarousel = ({ urls }: { urls: string[] }) => {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const count = urls.length;

  if (count === 1) return <YouTubeFacade url={urls[0]} />;

  const current = Math.min(index, count - 1);
  const go = (dir: number) => setIndex((i) => (i + dir + count) % count);
  const navClass =
    "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-foreground/25 text-foreground transition-colors duration-fast hover:bg-foreground/10";

  return (
    <div className="space-y-3">
      <YouTubeFacade key={current} url={urls[current]} />
      <div className="flex items-center justify-center gap-4">
        <button type="button" onClick={() => go(-1)} aria-label={t("media.previousVideo")} className={navClass}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          {urls.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t("media.goToVideo", { index: i + 1 })}
              aria-current={i === current}
              className={cn(
                "h-2 w-2 rounded-full transition-colors duration-fast",
                i === current ? "bg-foreground" : "bg-foreground/30 hover:bg-foreground/50",
              )}
            />
          ))}
        </div>
        <button type="button" onClick={() => go(1)} aria-label={t("media.nextVideo")} className={navClass}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

// Tap-to-play YouTube facade — light thumbnail until tapped, then the real
// (privacy-enhanced, autoplay) iframe. Degrades to an unavailable card.
const YouTubeFacade = ({ url }: { url: string }) => {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const id = parseYouTubeId(url);

  if (!id) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-muted text-sm font-medium text-muted-foreground">
        {t("media.videoUnavailable")}
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-md dark:shadow-none dark:ring-1 dark:ring-white/10">
      {playing ? (
        <iframe
          src={youTubeEmbedUrl(id)}
          title="YouTube"
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={t("media.playVideo")}
          className="absolute inset-0 h-full w-full"
        >
          {thumbBroken ? (
            <span className="flex h-full w-full items-center justify-center bg-foreground/[0.06] text-sm font-medium text-white/70">
              {t("media.playVideo")}
            </span>
          ) : (
            <img
              src={youTubeThumbnailUrl(id)}
              alt=""
              loading="lazy"
              onError={() => setThumbBroken(true)}
              className="h-full w-full object-cover"
            />
          )}
          <span aria-hidden="true" className="absolute inset-0 bg-black/15" />
          <span aria-hidden="true" className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm">
            <Play className="ml-0.5 h-7 w-7 fill-current" />
          </span>
        </button>
      )}
    </div>
  );
};

export default MediaDetail;
