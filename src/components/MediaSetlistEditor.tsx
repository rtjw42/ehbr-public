// ── Media & setlist editor ───────────────────────────────────────────────────
// Admin dialog for an event's media (YouTube videos + photo-album links) and
// setlist (songs + optional streaming links), opened from the event detail page.
// This is the *only* place media/setlist are edited — EventForm owns event basics.
// Writes go through updateEventMedia after the admin session is re-verified; the
// service re-validates/strips on the way in.
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, ClipboardList, Images, ListMusic, Loader2, Plus, Trash2, Video, type LucideIcon } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EventItem, type MediaItem, type SetlistEntry } from "@/lib/events";
import { getErrorMessage } from "@/lib/errors";
import { isSafeHttpUrl, parseSetlistText, parseYouTubeId } from "@/lib/media";
import { updateEventMedia } from "@/services/events";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { Collapse } from "@/components/ui/collapse";

// Editor caps — generous UX limits below the service's hard safety bounds.
const MAX_VIDEOS = 5;
const MAX_PHOTO_ALBUMS = 5;
const MAX_SONGS = 30;

// Client-only stable keys so removing a middle row never re-binds input state to
// the wrong row.
const newRowUid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `row-${Math.random().toString(36).slice(2)}`;

type MediaRow = { uid: string; type: MediaItem["type"]; url: string; title: string };
type SongRow = { uid: string; title: string; spotify: string; apple: string; youtube: string };

const toMediaRows = (items: MediaItem[]): MediaRow[] =>
  items.map((item) => ({ uid: newRowUid(), type: item.type, url: item.url, title: item.title ?? "" }));

const toSongRows = (entries: SetlistEntry[]): SongRow[] =>
  entries.map((entry) => ({
    uid: newRowUid(),
    title: entry.title,
    spotify: entry.spotify ?? "",
    apple: entry.apple ?? "",
    youtube: entry.youtube ?? "",
  }));

interface Props {
  event: EventItem;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const MediaSetlistEditor = ({ event, open, onClose, onSaved }: Props) => {
  const { ensureAdminSession } = useAdmin();
  const { t } = useI18n();
  const [mediaRows, setMediaRows] = useState<MediaRow[]>([]);
  const [setlistRows, setSetlistRows] = useState<SongRow[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [errors, setErrors] = useState<{ media?: string; setlist?: string }>({});
  const [saving, setSaving] = useState(false);
  // Contacts-style sections: both collapsed by default on every open.
  const [mediaSectionOpen, setMediaSectionOpen] = useState(false);
  const [setlistSectionOpen, setSetlistSectionOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMediaRows(toMediaRows(event.media));
    setSetlistRows(toSongRows(event.setlist));
    setPasteOpen(false);
    setPasteText("");
    setErrors({});
    setMediaSectionOpen(false);
    setSetlistSectionOpen(false);
  }, [open, event]);

  const videoCount = mediaRows.filter((row) => row.type === "youtube").length;
  const albumCount = mediaRows.filter((row) => row.type === "photo_album").length;

  const addMediaRow = (type: MediaItem["type"]) => {
    setMediaRows((current) => [...current, { uid: newRowUid(), type, url: "", title: "" }]);
    setErrors((current) => ({ ...current, media: undefined }));
  };
  const updateMediaRow = (uid: string, patch: Partial<Pick<MediaRow, "url" | "title">>) => {
    setMediaRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    setErrors((current) => ({ ...current, media: undefined }));
  };
  const removeMediaRow = (uid: string) =>
    setMediaRows((current) => current.filter((row) => row.uid !== uid));

  const addSongRow = () => {
    setSetlistRows((current) => [...current, { uid: newRowUid(), title: "", spotify: "", apple: "", youtube: "" }]);
    setErrors((current) => ({ ...current, setlist: undefined }));
  };
  const updateSongRow = (uid: string, patch: Partial<Omit<SongRow, "uid">>) => {
    setSetlistRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    setErrors((current) => ({ ...current, setlist: undefined }));
  };
  const removeSongRow = (uid: string) =>
    setSetlistRows((current) => current.filter((row) => row.uid !== uid));

  // Parse a pasted Telegram setlist into title-only rows, appended (capped). The
  // admin adds streaming links by hand afterwards.
  const parsePastedSetlist = () => {
    const titles = parseSetlistText(pasteText);
    if (titles.length === 0) return;
    setSetlistRows((current) => {
      const room = Math.max(0, MAX_SONGS - current.length);
      const additions = titles.slice(0, room).map((title) => ({ uid: newRowUid(), title, spotify: "", apple: "", youtube: "" }));
      return [...current, ...additions];
    });
    setPasteText("");
    setPasteOpen(false);
  };

  // Build typed arrays from rows, dropping empties. Returns null + sets an inline
  // error if a non-empty entry is malformed, so a bad link is caught here.
  const collectMedia = (): MediaItem[] | null => {
    const items: MediaItem[] = [];
    for (const row of mediaRows) {
      const url = row.url.trim();
      if (!url) continue;
      const ok = row.type === "youtube" ? !!parseYouTubeId(url) : isSafeHttpUrl(url);
      if (!ok) {
        setErrors((current) => ({ ...current, media: t(row.type === "youtube" ? "eventForm.invalidYouTube" : "eventForm.invalidUrl") }));
        return null;
      }
      // Photo albums can carry an optional name; videos stand on their own.
      const title = row.title.trim();
      items.push({ type: row.type, url, ...(row.type === "photo_album" && title ? { title } : {}) });
    }
    return items;
  };

  const collectSetlist = (): SetlistEntry[] | null => {
    const entries: SetlistEntry[] = [];
    for (const row of setlistRows) {
      const songTitle = row.title.trim();
      if (!songTitle) continue;
      const links = { spotify: row.spotify.trim(), apple: row.apple.trim(), youtube: row.youtube.trim() };
      for (const link of Object.values(links)) {
        if (link && !isSafeHttpUrl(link)) {
          setErrors((current) => ({ ...current, setlist: t("eventForm.invalidUrl") }));
          return null;
        }
      }
      entries.push({
        title: songTitle,
        ...(links.spotify ? { spotify: links.spotify } : {}),
        ...(links.apple ? { apple: links.apple } : {}),
        ...(links.youtube ? { youtube: links.youtube } : {}),
      });
    }
    return entries;
  };

  const handleSave = async () => {
    if (saving) return;
    const media = collectMedia();
    if (media === null) return;
    const setlist = collectSetlist();
    if (setlist === null) return;
    if (!(await ensureAdminSession())) return;
    setSaving(true);
    try {
      await updateEventMedia(event.id, { media, setlist });
      toast.success(t("mediaEditor.saved"));
      onSaved();
      onClose();
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("mediaEditor.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(32rem,calc(100vw-1rem))] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t("mediaEditor.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <EditorSection
            icon={Video}
            title={t("eventForm.mediaSection")}
            count={mediaRows.length}
            open={mediaSectionOpen}
            onToggle={() => setMediaSectionOpen((o) => !o)}
          >
            {errors.media && <p className="text-xs text-destructive">{errors.media}</p>}
            {mediaRows.map((row) => (
              <MediaRowEditor key={row.uid} row={row} onChange={(patch) => updateMediaRow(row.uid, patch)} onRemove={() => removeMediaRow(row.uid)} />
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={videoCount >= MAX_VIDEOS} onClick={() => addMediaRow("youtube")}>
                <Plus className="h-4 w-4" /> {t("eventForm.addVideo")}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={albumCount >= MAX_PHOTO_ALBUMS} onClick={() => addMediaRow("photo_album")}>
                <Plus className="h-4 w-4" /> {t("eventForm.addPhotoAlbum")}
              </Button>
            </div>
          </EditorSection>

          <EditorSection
            icon={ListMusic}
            title={t("eventForm.setlistSection")}
            count={setlistRows.length}
            open={setlistSectionOpen}
            onToggle={() => setSetlistSectionOpen((o) => !o)}
          >
            {errors.setlist && <p className="text-xs text-destructive">{errors.setlist}</p>}
            <div className="space-y-2 rounded-lg border border-dashed border-border/70 p-2.5">
              <button
                type="button"
                onClick={() => setPasteOpen((o) => !o)}
                aria-expanded={pasteOpen}
                className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground"
              >
                <ClipboardList className="h-4 w-4" />
                {t("eventForm.pasteFromTelegram")}
                <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform duration-base", pasteOpen && "rotate-180")} />
              </button>
              <Collapse show={pasteOpen} className="space-y-2 pt-1">
                <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} className="h-28 resize-none text-sm" placeholder={t("eventForm.placeholder.pasteSetlist")} />
                <Button type="button" size="sm" variant="outline" disabled={!pasteText.trim() || setlistRows.length >= MAX_SONGS} onClick={parsePastedSetlist}>
                  {t("eventForm.parse")}
                </Button>
              </Collapse>
            </div>
            {setlistRows.map((row, index) => (
              <SongRowEditor key={row.uid} row={row} index={index} onChange={(patch) => updateSongRow(row.uid, patch)} onRemove={() => removeSongRow(row.uid)} />
            ))}
            <Button type="button" size="sm" variant="outline" disabled={setlistRows.length >= MAX_SONGS} onClick={addSongRow}>
              <Plus className="h-4 w-4" /> {t("eventForm.addSong")}
            </Button>
          </EditorSection>
        </DialogBody>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} className="w-full rounded-full shadow-sm sm:w-auto">{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving} className="w-full rounded-full border-0 bg-interactive text-interactive-text shadow-md transition-[background-color,box-shadow,transform] duration-fast hover:opacity-90 sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Collapsible category card, mirroring the footer contact manager: header button
// (icon + label + count) with a chevron, body via <Collapse> (grid-rows height
// glide — expands and collapses smoothly).
const EditorSection = ({
  icon: Icon,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) => (
  <div className="overflow-hidden rounded-xl border bg-background/60">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
    >
      <span className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{title}</span>
        {count > 0 && <span className="type-badge rounded-full bg-muted px-1.5 text-muted-foreground">{count}</span>}
      </span>
      <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base", open && "rotate-180")} />
    </button>
    <Collapse show={open} className="space-y-2.5 px-4 pb-4">{children}</Collapse>
  </div>
);

const MediaRowEditor = ({
  row,
  onChange,
  onRemove,
}: {
  row: MediaRow;
  onChange: (patch: Partial<Pick<MediaRow, "url" | "title">>) => void;
  onRemove: () => void;
}) => {
  const { t } = useI18n();
  const isVideo = row.type === "youtube";

  return (
    <div className="space-y-2 rounded-lg bg-card/60 p-2.5 shadow-sm">
      <div className="flex items-center gap-2">
        {isVideo ? <Video className="h-4 w-4 text-muted-foreground" /> : <Images className="h-4 w-4 text-muted-foreground" />}
        <span className="text-xs font-medium text-muted-foreground">{t(isVideo ? "eventForm.videoLabel" : "eventForm.photoAlbumLabel")}</span>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label={t(isVideo ? "eventForm.removeVideo" : "eventForm.removePhotoAlbum")} className="ml-auto h-7 w-7 shrink-0">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {!isVideo && (
        <Input
          value={row.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t("eventForm.photoAlbumName")}
          maxLength={120}
          aria-label={t("eventForm.photoAlbumName")}
        />
      )}
      <Input value={row.url} onChange={(e) => onChange({ url: e.target.value })} placeholder={t(isVideo ? "eventForm.placeholder.youtube" : "eventForm.placeholder.photoAlbum")} maxLength={500} inputMode="url" aria-label={t(isVideo ? "eventForm.videoLabel" : "eventForm.photoAlbumLabel")} />
    </div>
  );
};

const SongRowEditor = ({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: SongRow;
  index: number;
  onChange: (patch: Partial<Omit<SongRow, "uid">>) => void;
  onRemove: () => void;
}) => {
  const { t } = useI18n();

  return (
    <div className="space-y-2 rounded-lg bg-card/60 p-2.5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}.</span>
        <Input className="flex-1" value={row.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t("eventForm.placeholder.songTitle")} maxLength={200} aria-label={t("eventForm.songTitle")} />
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label={t("eventForm.removeSong")} className="h-7 w-7 shrink-0">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Input value={row.spotify} onChange={(e) => onChange({ spotify: e.target.value })} placeholder={t("eventForm.spotifyLink")} maxLength={500} inputMode="url" />
      <Input value={row.apple} onChange={(e) => onChange({ apple: e.target.value })} placeholder={t("eventForm.appleLink")} maxLength={500} inputMode="url" />
      <Input value={row.youtube} onChange={(e) => onChange({ youtube: e.target.value })} placeholder={t("eventForm.youtubeLink")} maxLength={500} inputMode="url" />
    </div>
  );
};
