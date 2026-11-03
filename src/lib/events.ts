import { isSameDay } from "date-fns";

// ── Media & setlist model ──────────────────────────────────────────────────────
// Persisted as two jsonb arrays on `events` (no separate table). New media types
// later = add a `type` here + teach the parser/renderer, zero schema change.
export type MediaType = "youtube" | "photo_album";

export type MediaItem = {
  type: MediaType;
  url: string;
  title?: string;
};

// One setlist song; each streaming link is optional and only rendered when present.
export type SetlistEntry = {
  title: string;
  spotify?: string;
  apple?: string;
  youtube?: string;
};

export const SETLIST_PLATFORMS = ["spotify", "apple", "youtube"] as const;
export type SetlistPlatform = (typeof SETLIST_PLATFORMS)[number];

export type EventItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_date: string; // ISO
  end_date: string | null;
  poster_url: string | null;
  media: MediaItem[];
  setlist: SetlistEntry[];
  created_at: string;
  updated_at: string;
};

export function eventsForDay(events: EventItem[], day: Date) {
  return events.filter((e) => isSameDay(new Date(e.event_date), day));
}

// True when an event carries any media or setlist content — i.e. it has a
// /media/:eventId page worth linking to. Shared by the Media index and the
// Events page's per-card "Media" entry point.
export function hasMediaContent(event: EventItem) {
  return event.media.length > 0 || event.setlist.length > 0;
}
