// ── Media & setlist form ─────────────────────────────────────────────────────
// Admin-only editor for an event's media (YouTube videos + photo-album links) and
// setlist (songs + optional streaming links), opened from /media and /media/:id.
// This is the *only* place media/setlist are edited — EventForm owns event basics.
// Writes go through updateEventMedia after the admin session is re-verified; the
// service re-validates/strips on the way in.
//
// On FormShell (DESIGN_SYSTEM.md → Form System). Media and Setlist are pushed
// screens off a root that shows their counts; each song's streaming links are a
// per-song screen behind `›`; Paste-from-Telegram is a pushed screen because its
// textarea summons the keyboard, which an anchored dropdown cannot fit around.
// Errors are per row, keyed by uid, and a refused save pushes the screen the bad
// field lives on (see `save`).
import { useLayoutEffect, useRef, useState } from "react";
import { ClipboardList, Images, ListMusic, Loader2, Plus, Video } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldRow } from "@/components/ui/field-row";
import { FormField } from "@/components/ui/form-field";
import { FormShell, type FormScreen } from "@/components/ui/form-shell";
import { Input } from "@/components/ui/input";
import { PickerDropdown } from "@/components/ui/picker-dropdown";
import { Row, RowIconInput, RowOpenButton, RowRemoveButton, newRowUid, useRowFocus } from "@/components/ui/row-list";
import { Textarea } from "@/components/ui/textarea";
import type { EventItem, MediaItem, SetlistEntry } from "@/lib/events";
import { getErrorMessage } from "@/lib/errors";
import { isSafeHttpUrl, parseSetlistText, parseYouTubeId } from "@/lib/media";
import { updateEventMedia } from "@/services/events";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { useInvalidFieldFocus } from "@/hooks/useInvalidFieldFocus";

// Editor caps — generous UX limits below the service's hard safety bounds. Media
// caps are PER TYPE (unlike contacts, where the cap is a total), so the Add
// dropdown greys each option out on its own.
const MAX_VIDEOS = 5;
const MAX_PHOTO_ALBUMS = 5;
const MAX_SONGS = 30;

type MediaRow = { uid: string; type: MediaItem["type"]; url: string; title: string };
type SongRow = { uid: string; title: string; spotify: string; apple: string; youtube: string };

type SongLink = "spotify" | "apple" | "youtube";
// Visual order on the per-song screen.
const SONG_LINKS: readonly SongLink[] = ["spotify", "apple", "youtube"];
const SONG_LINK_LABEL = { spotify: "eventForm.spotifyLink", apple: "eventForm.appleLink", youtube: "eventForm.youtubeLink" } as const;
// A song's three links are three fields, so each gets its own error key.
const songLinkKey = (uid: string, link: SongLink) => `${uid}:${link}`;

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

// Where the user is. Save lives on the root only; everything else is pushed off
// it and Back pops. `song` and `paste` sit on top of `setlist`, so Back from
// either lands on the list rather than the root.
type Screen =
  | { kind: "root" }
  | { kind: "media" }
  | { kind: "setlist" }
  | { kind: "song"; uid: string }
  | { kind: "paste" };

const ROOT: Screen = { kind: "root" };
const MEDIA: Screen = { kind: "media" };
const SETLIST: Screen = { kind: "setlist" };
const PASTE: Screen = { kind: "paste" };

// The songs list is ONE field with a counter; the Add button carries its id, being
// the one control guaranteed to be on screen (rows come and go).
const SONGS_FIELD_ID = "setlist-songs";

interface Props {
  open: boolean;
  /** The event whose media is being edited; null until the host has picked one. */
  event: EventItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export const MediaSetlistForm = ({ open, event, onClose, onSaved }: Props) => {
  const { ensureAdminSession } = useAdmin();
  const { t } = useI18n();
  const [mediaRows, setMediaRows] = useState<MediaRow[]>([]);
  const [songRows, setSongRows] = useState<SongRow[]>([]);
  const [screen, setScreen] = useState<Screen>(ROOT);
  const [pasteText, setPasteText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Keyed by media-row uid or `songLinkKey`; only URLs can be invalid.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // The field a refused save is taking the user to. Kept in STATE because it is
  // rendered — see the `data-form-autofocus` note in `save`.
  const [invalidTarget, setInvalidTarget] = useState<string | null>(null);

  const addAnchor = useRef<HTMLDivElement | null>(null);
  // A refused save scrolls to the first bad field and focuses it — the shared
  // behaviour (DESIGN_SYSTEM → Form System → Failure behaviour).
  const { setFieldRef, focusFirstInvalidField } = useInvalidFieldFocus<string>();
  // A freshly added row is scrolled to and focused (ui/row-list). Media URL
  // inputs are in both maps — focused when added, focused when invalid.
  const rowFocus = useRowFocus();
  const setMediaUrlRef = (uid: string) => (node: HTMLInputElement | null) => {
    rowFocus.setRowRef(uid)(node);
    setFieldRef(uid)(node);
  };

  // useLayoutEffect, NOT useEffect: both hosts keep this mounted and only flip
  // `open`, so every row still holds the last session's values when it reopens — a
  // passive effect paints those first and resets a frame later. That matters more
  // now that `saving` is cleared here rather than on save's success path: with a
  // passive effect a reopened form would paint one frame with Save still disabled.
  useLayoutEffect(() => {
    if (!open) return;
    setMediaRows(toMediaRows(event?.media ?? []));
    setSongRows(toSongRows(event?.setlist ?? []));
    setScreen(ROOT);
    setPasteText("");
    setPickerOpen(false);
    setErrors({});
    setInvalidTarget(null);
    setSaving(false);
  }, [open, event]);

  // Every navigation goes through here so nothing stale rides along: the Add
  // dropdown (anchored to a row that is about to crossfade out) and the invalid
  // target (its screen is being left, so a later save must set it afresh).
  const go = (next: Screen) => {
    setScreen(next);
    setPickerOpen(false);
    setInvalidTarget(null);
  };

  // ── Failure behaviour ───────────────────────────────────────────────────────
  // The bad field may sit on a screen that is not showing, so `save` pushes that
  // screen and sets `invalidTarget`; this runs once that screen has COMMITTED, when
  // the input exists to be scrolled to. A LAYOUT effect with an INSTANT scroll:
  // the pushed screen is still at opacity 0 before its first paint, so the jump
  // is invisible — a smooth scroll from a passive effect would have run underneath
  // the 260ms crossfade, moving content while it faded in. Sequencing with
  // FormShell: it moves focus into every newly activated screen ~40ms after
  // commit — `[data-form-autofocus]` first, else the first control — so the
  // target input carries that attribute for the push and both focuses land on
  // the same element. Runs once per target: `go()` clears it on every
  // navigation, so a second refused save sets it afresh and this fires again.
  useLayoutEffect(() => {
    if (!invalidTarget) return;
    focusFirstInvalidField({ [invalidTarget]: "invalid" }, [invalidTarget], { behavior: "instant" });
  }, [invalidTarget, focusFirstInvalidField]);

  const videoCount = mediaRows.filter((row) => row.type === "youtube").length;
  const albumCount = mediaRows.filter((row) => row.type === "photo_album").length;
  const atSongCap = songRows.length >= MAX_SONGS;

  const clearError = (key: string) =>
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });

  const addMediaRow = (type: MediaItem["type"]) => {
    const uid = newRowUid();
    setMediaRows((current) => [...current, { uid, type, url: "", title: "" }]);
    rowFocus.focusRowOnCommit(uid);
    setPickerOpen(false);
  };
  const updateMediaRow = (uid: string, patch: Partial<Pick<MediaRow, "url" | "title">>) => {
    setMediaRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    if (patch.url !== undefined) clearError(uid);
  };
  const removeMediaRow = (uid: string) => {
    setMediaRows((current) => current.filter((row) => row.uid !== uid));
    clearError(uid);
  };

  const addSongRow = () => {
    const uid = newRowUid();
    setSongRows((current) => [...current, { uid, title: "", spotify: "", apple: "", youtube: "" }]);
    rowFocus.focusRowOnCommit(uid);
  };
  const updateSongRow = (uid: string, patch: Partial<Omit<SongRow, "uid">>) => {
    setSongRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    for (const link of SONG_LINKS) if (patch[link] !== undefined) clearError(songLinkKey(uid, link));
  };
  const removeSongRow = (uid: string) => {
    setSongRows((current) => current.filter((row) => row.uid !== uid));
    for (const link of SONG_LINKS) clearError(songLinkKey(uid, link));
  };

  // Parse a pasted Telegram setlist into title-only rows, appended (capped), then
  // pop back to the list. The admin adds streaming links by hand afterwards.
  const parsePastedSetlist = () => {
    const titles = parseSetlistText(pasteText);
    if (titles.length === 0) return;
    const room = Math.max(0, MAX_SONGS - songRows.length);
    const additions = titles.slice(0, room).map((title) => ({ uid: newRowUid(), title, spotify: "", apple: "", youtube: "" }));
    setSongRows((current) => [...current, ...additions]);
    setPasteText("");
    // The list comes back with its scroll at 0; put the first pasted song at
    // the top so what follows is what was just added, not what was there.
    if (additions[0]) rowFocus.revealRowOnCommit(additions[0].uid, "start");
    go(SETLIST);
  };

  // Back from a song's own screen. The body scroller sat at 0 while that short
  // screen was up, so without this a 30-song list would reopen at the top
  // however far down the song was.
  const backToSetlist = (fromUid: string) => {
    rowFocus.revealRowOnCommit(fromUid, "center");
    go(SETLIST);
  };

  // Build typed arrays from rows, dropping empties. Every malformed entry gets its
  // message in `into` (not just the first — each bad row shows its own line), and
  // null comes back if there was any.
  const collectMedia = (into: Record<string, string>): MediaItem[] | null => {
    const items: MediaItem[] = [];
    let ok = true;
    for (const row of mediaRows) {
      const url = row.url.trim();
      if (!url) continue;
      const valid = row.type === "youtube" ? !!parseYouTubeId(url) : isSafeHttpUrl(url);
      if (!valid) {
        into[row.uid] = t(row.type === "youtube" ? "eventForm.invalidYouTube" : "eventForm.invalidUrl");
        ok = false;
        continue;
      }
      // Photo albums can carry an optional name; videos stand on their own.
      const title = row.title.trim();
      items.push({ type: row.type, url, ...(row.type === "photo_album" && title ? { title } : {}) });
    }
    return ok ? items : null;
  };

  const collectSetlist = (into: Record<string, string>): SetlistEntry[] | null => {
    const entries: SetlistEntry[] = [];
    let ok = true;
    for (const row of songRows) {
      const songTitle = row.title.trim();
      if (!songTitle) continue;
      const links = { spotify: row.spotify.trim(), apple: row.apple.trim(), youtube: row.youtube.trim() };
      for (const link of SONG_LINKS) {
        if (links[link] && !isSafeHttpUrl(links[link])) {
          into[songLinkKey(row.uid, link)] = t("eventForm.invalidUrl");
          ok = false;
        }
      }
      entries.push({
        title: songTitle,
        ...(links.spotify ? { spotify: links.spotify } : {}),
        ...(links.apple ? { apple: links.apple } : {}),
        ...(links.youtube ? { youtube: links.youtube } : {}),
      });
    }
    return ok ? entries : null;
  };

  // Visual order across the whole form: the Media screen top to bottom, then each
  // song's links in screen order. "First invalid" means the topmost of these.
  const fieldOrder = [
    ...mediaRows.map((row) => row.uid),
    ...songRows.flatMap((row) => SONG_LINKS.map((link) => songLinkKey(row.uid, link))),
  ];
  const screenForField = (key: string): Screen =>
    mediaRows.some((row) => row.uid === key) ? MEDIA : { kind: "song", uid: key.slice(0, key.lastIndexOf(":")) };

  const save = async () => {
    if (saving || !event) return;
    const nextErrors: Record<string, string> = {};
    const media = collectMedia(nextErrors);
    const setlist = collectSetlist(nextErrors);
    setErrors(nextErrors);
    const firstInvalid = fieldOrder.find((key) => nextErrors[key]);
    if (firstInvalid || media === null || setlist === null) {
      // Push the screen the field lives on and let the effect above land on it.
      // Deliberately not `go()`: that clears the target this is setting.
      if (firstInvalid) {
        setScreen(screenForField(firstInvalid));
        setPickerOpen(false);
        setInvalidTarget(firstInvalid);
      }
      return;
    }
    // `saving` goes up BEFORE the session check, not after. ensureAdminSession is a
    // live network round-trip; on a phone that is a real pause during which the
    // button showed no spinner AND the `if (saving) return` guard did not hold, so
    // a second tap started a second save. The write is an idempotent update on a
    // known id, so this was noise rather than corruption — but it is the same bug
    // ContactsForm had, and one shape is worth more than two.
    setSaving(true);
    try {
      if (!(await ensureAdminSession())) {
        setSaving(false);
        return;
      }
      await updateEventMedia(event.id, { media, setlist });
      toast.success(t("mediaForm.saved"));
      // Closing is the host's, through onSaved — the same as every other form.
      onSaved();
      // Deliberately NOT cleared on success — the sheet is exit-animating by now.
      // The open reset clears it instead.
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("mediaForm.saveFailed")));
      setSaving(false);
    }
  };

  // ── Root ────────────────────────────────────────────────────────────────────
  const countLabel = (count: number, one: "mediaForm.videoOne" | "mediaForm.albumOne" | "mediaForm.songOne", many: "mediaForm.videoMany" | "mediaForm.albumMany" | "mediaForm.songMany") =>
    count === 1 ? t(one) : t(many, { count });
  const mediaSummary = [
    videoCount > 0 ? countLabel(videoCount, "mediaForm.videoOne", "mediaForm.videoMany") : null,
    albumCount > 0 ? countLabel(albumCount, "mediaForm.albumOne", "mediaForm.albumMany") : null,
  ].filter(Boolean).join(" · ");
  const setlistSummary = songRows.length > 0 ? countLabel(songRows.length, "mediaForm.songOne", "mediaForm.songMany") : "";

  const rootScreen: FormScreen = {
    key: "root",
    title: t("mediaForm.title"),
    body: (
      <div className="space-y-4">
        <FormField id="media-root" label={t("mediaForm.media")}>
          <FieldRow
            id="media-root"
            icon={<Video className="h-4 w-4" aria-hidden />}
            value={mediaSummary || t("mediaForm.mediaEmpty")}
            placeholder={!mediaSummary}
            onClick={() => go(MEDIA)}
          />
        </FormField>
        <FormField id="setlist-root" label={t("mediaForm.setlist")}>
          <FieldRow
            id="setlist-root"
            icon={<ListMusic className="h-4 w-4" aria-hidden />}
            value={setlistSummary || t("mediaForm.setlistEmpty")}
            placeholder={!setlistSummary}
            onClick={() => go(SETLIST)}
          />
        </FormField>
      </div>
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </>
    ),
  };

  // ── Media ───────────────────────────────────────────────────────────────────
  const atMediaCap = videoCount >= MAX_VIDEOS && albumCount >= MAX_PHOTO_ALBUMS;

  const mediaScreen: FormScreen = {
    key: "media",
    title: t("mediaForm.media"),
    onBack: () => go(ROOT),
    body: (
      <div className="space-y-2.5">
        {mediaRows.map((row) => {
          const isVideo = row.type === "youtube";
          const inputId = `media-${row.uid}`;
          const typeLabel = t(isVideo ? "eventForm.videoLabel" : "eventForm.photoAlbumLabel");
          return (
            <Row key={row.uid} actions={<RowRemoveButton onClick={() => removeMediaRow(row.uid)} label={t(isVideo ? "eventForm.removeVideo" : "eventForm.removePhotoAlbum")} />}>
              <div className="space-y-2">
                {/* An album's optional name sits ABOVE the FormField, not inside it,
                    so a URL error reddens only the URL input. Albums are rare, so
                    two stacked inputs beat a per-album screen. */}
                {!isVideo && (
                  <Input
                    value={row.title}
                    onChange={(event) => updateMediaRow(row.uid, { title: event.target.value })}
                    placeholder={t("eventForm.photoAlbumName")}
                    maxLength={120}
                    aria-label={t("eventForm.photoAlbumName")}
                  />
                )}
                {/* The icon IS the row's visible label — the hidden one names it
                    for assistive tech, and the error line lands beneath the URL. */}
                <FormField id={inputId} label={typeLabel} labelHidden error={errors[row.uid]}>
                  <RowIconInput icon={isVideo ? <Video /> : <Images />}>
                    <Input
                      id={inputId}
                      ref={setMediaUrlRef(row.uid)}
                      data-form-autofocus={invalidTarget === row.uid ? "" : undefined}
                      value={row.url}
                      onChange={(event) => updateMediaRow(row.uid, { url: event.target.value })}
                      placeholder={t(isVideo ? "eventForm.placeholder.youtube" : "eventForm.placeholder.photoAlbum")}
                      maxLength={500}
                      inputMode="url"
                    />
                  </RowIconInput>
                </FormField>
              </div>
            </Row>
          );
        })}

        {/* Add — bounded content (two types), so a dropdown rather than a pushed
            screen. Each option greys at its OWN cap; the row itself only once
            both are full. Disabled rather than removed: a control that vanishes
            is a layout change. */}
        <div className="relative" ref={addAnchor}>
          {/* Takes FormShell's screen autofocus (a button, so no keyboard rises
              mid-crossfade — the first URL input would summon one on Android).
              Yields to a bad row when a refused save pushed this screen. */}
          <FieldRow
            icon={<Plus className="h-4 w-4" aria-hidden />}
            value={t("mediaForm.addMedia")}
            disabled={atMediaCap}
            autofocus={!invalidTarget}
            onClick={() => setPickerOpen((current) => !current)}
          />
          <PickerDropdown
            open={pickerOpen && !atMediaCap}
            onClose={() => setPickerOpen(false)}
            anchorRef={addAnchor}
            ariaLabel={t("mediaForm.chooseMediaType")}
          >
            <div className="space-y-0.5">
              <Button type="button" variant="ghost" disabled={videoCount >= MAX_VIDEOS} onClick={() => addMediaRow("youtube")} className="min-h-11 w-full justify-start gap-2.5 px-3">
                <Video className="h-4 w-4" aria-hidden />
                {t("eventForm.videoLabel")}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{t("common.charCounter", { count: videoCount, max: MAX_VIDEOS })}</span>
              </Button>
              <Button type="button" variant="ghost" disabled={albumCount >= MAX_PHOTO_ALBUMS} onClick={() => addMediaRow("photo_album")} className="min-h-11 w-full justify-start gap-2.5 px-3">
                <Images className="h-4 w-4" aria-hidden />
                {t("eventForm.photoAlbumLabel")}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{t("common.charCounter", { count: albumCount, max: MAX_PHOTO_ALBUMS })}</span>
              </Button>
            </div>
          </PickerDropdown>
        </div>
      </div>
    ),
    footer: <Button onClick={() => go(ROOT)}>{t("common.done")}</Button>,
  };

  // ── Setlist ─────────────────────────────────────────────────────────────────
  const setlistScreen: FormScreen = {
    key: "setlist",
    title: t("mediaForm.setlist"),
    onBack: () => go(ROOT),
    body: (
      <div className="space-y-4">
        {/* Bulk paste is the primary flow, so it leads. A pushed screen: the
            textarea needs the keyboard, which a dropdown cannot make room for. */}
        <FieldRow
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
          value={t("eventForm.pasteFromTelegram")}
          disabled={atSongCap}
          onClick={() => go(PASTE)}
        />
        <FormField
          id={SONGS_FIELD_ID}
          label={t("mediaForm.songs")}
          labelTrailing={t("common.charCounter", { count: songRows.length, max: MAX_SONGS })}
        >
          <div className="space-y-2.5">
            {songRows.map((row, index) => (
              <Row
                key={row.uid}
                leading={`${index + 1}.`}
                actions={
                  <>
                    <RowOpenButton onClick={() => go({ kind: "song", uid: row.uid })} label={t("mediaForm.songLinks", { n: index + 1 })} />
                    <RowRemoveButton onClick={() => removeSongRow(row.uid)} label={t("eventForm.removeSong")} />
                  </>
                }
              >
                <Input
                  ref={rowFocus.setRowRef(row.uid)}
                  value={row.title}
                  onChange={(event) => updateSongRow(row.uid, { title: event.target.value })}
                  placeholder={t("eventForm.placeholder.songTitle")}
                  maxLength={200}
                  aria-label={t("eventForm.songTitle")}
                />
              </Row>
            ))}
            {/* A plain button, not a FieldRow: `›` means "opens", and this adds. */}
            <Button id={SONGS_FIELD_ID} type="button" variant="outline" disabled={atSongCap} onClick={addSongRow} className="min-h-11 w-full">
              <Plus className="h-4 w-4" aria-hidden />
              {t("eventForm.addSong")}
            </Button>
          </div>
        </FormField>
      </div>
    ),
    footer: <Button onClick={() => go(ROOT)}>{t("common.done")}</Button>,
  };

  // ── Song ────────────────────────────────────────────────────────────────────
  const songIndex = screen.kind === "song" ? songRows.findIndex((row) => row.uid === screen.uid) : -1;
  const song = songIndex >= 0 ? songRows[songIndex] : null;

  const songScreen: FormScreen | null = song ? {
    key: `song:${song.uid}`,
    title: t("mediaForm.songTitle", { n: songIndex + 1 }),
    onBack: () => backToSetlist(song.uid),
    body: (
      <div className="space-y-4">
        {SONG_LINKS.map((link) => {
          const key = songLinkKey(song.uid, link);
          const inputId = `song-${key}`;
          return (
            <FormField key={link} id={inputId} label={t(SONG_LINK_LABEL[link])} error={errors[key]}>
              <Input
                id={inputId}
                ref={setFieldRef(key)}
                data-form-autofocus={invalidTarget === key ? "" : undefined}
                value={song[link]}
                onChange={(event) => updateSongRow(song.uid, { [link]: event.target.value })}
                placeholder="https://"
                maxLength={500}
                inputMode="url"
              />
            </FormField>
          );
        })}
      </div>
    ),
    footer: <Button onClick={() => backToSetlist(song.uid)}>{t("common.done")}</Button>,
  } : null;

  // ── Paste ───────────────────────────────────────────────────────────────────
  const pasteScreen: FormScreen = {
    key: "paste",
    title: t("eventForm.pasteFromTelegram"),
    onBack: () => go(SETLIST),
    body: (
      <FormField id="paste-text" label={t("mediaForm.pasteLabel")}>
        <Textarea
          id="paste-text"
          data-form-autofocus=""
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder={t("eventForm.placeholder.pasteSetlist")}
          className="min-h-[14rem] resize-none"
        />
      </FormField>
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={() => go(SETLIST)}>{t("common.back")}</Button>
        <Button onClick={parsePastedSetlist} disabled={!pasteText.trim() || atSongCap}>{t("eventForm.parse")}</Button>
      </>
    ),
  };

  const stack: FormScreen[] =
    screen.kind === "media" ? [rootScreen, mediaScreen]
    : screen.kind === "setlist" ? [rootScreen, setlistScreen]
    : screen.kind === "paste" ? [rootScreen, setlistScreen, pasteScreen]
    // A song screen whose row is gone falls back to the list rather than
    // rendering nothing (cannot happen through the UI — removal is on the list).
    : screen.kind === "song" ? (songScreen ? [rootScreen, setlistScreen, songScreen] : [rootScreen, setlistScreen])
    : [rootScreen];

  return (
    <FormShell
      open={open}
      // Guarded here rather than through the screen's `dismissable` flag: that flag
      // also controls whether the close button renders, so toggling it on `saving`
      // would make the header jump the instant Save was pressed.
      onOpenChange={(next) => {
        if (next || saving) return;
        onClose();
      }}
      stack={stack}
    />
  );
};
