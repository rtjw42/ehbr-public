// ── Event media & setlist parsing ──────────────────────────────────────────────
// Pure, trust-nothing helpers shared by the events service (read/write) and the
// /media renderer. Two jobs:
//   1. Turn a user-pasted YouTube URL into a canonical video id (provider
//      allow-list — we only ever embed YouTube, never an arbitrary origin).
//   2. Normalize the jsonb arrays coming off the DB (or out of the form) into
//      typed, validated entries — dropping anything malformed so a bad row can
//      never crash the renderer or persist garbage. Used on both read and write,
//      so a round-trip is idempotent.
import type { MediaItem, SetlistEntry } from "@/lib/events";
import { SETLIST_PLATFORMS } from "@/lib/events";
import { stripHtmlText } from "@/lib/sanitize";

// Safety bounds on array length so a write can't balloon the row. These are
// defence-in-depth, well above any sane UX limit (the form caps videos tighter).
export const MAX_MEDIA_ITEMS = 20;
export const MAX_SETLIST_ENTRIES = 50;
const MAX_TITLE_LENGTH = 120;
const MAX_SONG_TITLE_LENGTH = 200;

// YouTube video ids are exactly 11 chars of [A-Za-z0-9_-].
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// Hostnames we accept a YouTube link from. Anything else is rejected outright —
// this is the provider allow-list, not just a convenience parser.
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

// Path-prefixed id forms: youtube.com/embed/<id>, /shorts/<id>, /live/<id>, /v/<id>.
const PATH_ID_PREFIXES = new Set(["embed", "shorts", "live", "v"]);

// http(s) only — blocks javascript:, data:, ftp:, etc. before a link is ever
// stored or turned into an href.
export const isSafeHttpUrl = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

// Extract a canonical 11-char video id from any accepted YouTube URL, or null if
// the URL isn't a recognised YouTube link with a valid id.
export const parseYouTubeId = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  // youtu.be/<id> — the id is the first path segment.
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }

  // watch?v=<id> (also music./m. variants).
  const queryId = url.searchParams.get("v");
  if (queryId && YOUTUBE_ID_PATTERN.test(queryId)) return queryId;

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>.
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && PATH_ID_PREFIXES.has(segments[0])) {
    const id = segments[1];
    return YOUTUBE_ID_PATTERN.test(id) ? id : null;
  }

  return null;
};

// Lightweight thumbnail facade source — no API key needed. hqdefault always
// exists for a public video.
export const youTubeThumbnailUrl = (id: string): string =>
  `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

// Privacy-enhanced embed origin (youtube-nocookie). autoplay=1 so the facade tap
// goes straight into the video; playsinline=1 is required for iOS Safari to play
// inside the page instead of forcing the native fullscreen player (which, mounted
// programmatically rather than from a direct tap on the player, often just fails).
export const youTubeEmbedUrl = (id: string): string =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1`;

// Optional, sanitised, length-capped title — returns the trimmed string or
// undefined so the persisted entry stays minimal.
const cleanTitle = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = stripHtmlText(value).slice(0, max);
  return text || undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Normalize an unknown jsonb value into validated MediaItem[]. Drops entries that
// aren't an accepted type, lack a usable url, or fail the per-type URL check.
export const parseMediaItems = (raw: unknown): MediaItem[] => {
  if (!Array.isArray(raw)) return [];
  const out: MediaItem[] = [];

  for (const entry of raw) {
    if (out.length >= MAX_MEDIA_ITEMS) break;
    if (!isRecord(entry)) continue;

    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) continue;
    const title = cleanTitle(entry.title, MAX_TITLE_LENGTH);

    if (entry.type === "youtube") {
      if (!parseYouTubeId(url)) continue;
      out.push(title ? { type: "youtube", url, title } : { type: "youtube", url });
    } else if (entry.type === "photo_album") {
      if (!isSafeHttpUrl(url)) continue;
      out.push(title ? { type: "photo_album", url, title } : { type: "photo_album", url });
    }
  }

  return out;
};

// Leading list marker: "1." / "2)" / "-" / "•" with trailing space(s).
const LIST_MARKER = /^\s*(?:\d+[.)]\s*|[-*•]\s+)/;
// Bare key-change annotation outside parens, e.g. "+ 1 semitone", "-2 semitones".
const KEY_CHANGE = /[+-]\s*\d+\s*semitones?/gi;

// Turn a pasted Telegram setlist into a list of plain song titles. The band's
// messages carry extra annotations — performer initials "(dj)/(rd)/(rj)", key
// changes, side-notes, the artist — which we strip, keeping only the song name
// (links are added by hand afterwards). If the paste is a numbered/bulleted list,
// only marked lines are songs (unmarked lines are continuations like a bare
// "(intro b4 ...)" note); otherwise every non-empty line is treated as a song.
export const parseSetlistText = (raw: string): string[] => {
  const lines = raw.split(/\r?\n/);
  const markedLines = lines.filter((line) => LIST_MARKER.test(line));
  const source = markedLines.length > 0 ? markedLines : lines;

  const titles: string[] = [];
  for (const line of source) {
    const title = line
      .replace(LIST_MARKER, "")
      .replace(/\([^)]*\)/g, " ") // (artist), (dj), (+2 semitones), notes
      .replace(KEY_CHANGE, " ") // bare "+ 1 semitone"
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/[\s,;]+$/, "")
      .trim();
    if (title) titles.push(title);
  }
  return titles;
};

// Normalize an unknown jsonb value into validated SetlistEntry[]. A song needs a
// title; each streaming link is kept only if it's a safe http(s) URL.
export const parseSetlistEntries = (raw: unknown): SetlistEntry[] => {
  if (!Array.isArray(raw)) return [];
  const out: SetlistEntry[] = [];

  for (const entry of raw) {
    if (out.length >= MAX_SETLIST_ENTRIES) break;
    if (!isRecord(entry)) continue;

    const title = cleanTitle(entry.title, MAX_SONG_TITLE_LENGTH);
    if (!title) continue;

    const song: SetlistEntry = { title };
    for (const platform of SETLIST_PLATFORMS) {
      const link = entry[platform];
      if (typeof link === "string" && isSafeHttpUrl(link)) {
        song[platform] = link.trim();
      }
    }
    out.push(song);
  }

  return out;
};
