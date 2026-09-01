// ── Events service ───────────────────────────────────────────────────────────
// Event CRUD plus poster upload. Reads are public; writes assume the caller has
// already verified a live admin session (RLS is the real enforcement). Poster
// bytes go through the upload-admin-file Edge Function, which re-validates the
// file server-side — the client-side checks here are just early UX feedback.
import { supabase } from "@/integrations/supabase/client";
import type { EventItem, MediaItem, SetlistEntry } from "@/lib/events";
import { MAX_EVENT_POSTER_BYTES } from "@/lib/file-validation";
import { parseMediaItems, parseSetlistEntries } from "@/lib/media";
import { stripHtmlText } from "@/lib/sanitize";

// ── Types ────────────────────────────────────────────────────────────────────
export type EventDraft = {
  title: string;
  description: string;
  location: string;
  eventDate: string;
  eventTime: string;
  endTime?: string;
  posterUrl: string | null;
  // Optional so existing callers (and Stage 2's untouched EventForm) keep working;
  // the form starts passing real arrays in Stage 3.
  media?: MediaItem[];
  setlist?: SetlistEntry[];
};

export type SaveEventInput = {
  editingId?: string;
  draft: EventDraft;
};

export type EventPosterUploadResult = {
  publicUrl: string;
};

type EventPayload = {
  title: string;
  description: string | null;
  location: string | null;
  event_date: string;
  end_date: string | null;
  poster_url: string | null;
  // Only present when the caller actually edits them. EventForm owns the basics and
  // leaves these out, so its updates must NOT touch the jsonb columns — those are
  // owned by updateEventMedia (the MediaSetlistEditor). Including them here with a
  // default would wipe an event's media/setlist on every basics edit.
  media?: MediaItem[];
  setlist?: SetlistEntry[];
};

// The DB returns media/setlist as untyped jsonb; everything else maps 1:1.
type RawEventRow = Omit<EventItem, "media" | "setlist"> & {
  media: unknown;
  setlist: unknown;
};

// Re-validate the jsonb arrays on the way out so a hand-edited or legacy row can
// never reach the UI with a bad entry.
const normalizeEventRow = (row: RawEventRow): EventItem => ({
  ...row,
  media: parseMediaItems(row.media),
  setlist: parseSetlistEntries(row.setlist),
});

// ── Error normalization ──────────────────────────────────────────────────────
// Map known server/Edge errors to safe user copy; fall back to a generic message
// so internals never leak.
const messageFromUnknown = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

export const normalizeEventError = (error: unknown, fallback: string) => {
  const message = messageFromUnknown(error);
  if (/5mb|too large|file size/i.test(message)) return "Poster image must be 5MB or smaller.";
  if (/jpeg|jpg|mime|content type|image/i.test(message)) return "Poster image must be a JPEG image.";
  return fallback;
};

const throwEventError = (error: unknown, fallback: string): never => {
  throw new Error(normalizeEventError(error, fallback));
};

const readFunctionErrorMessage = async (error: unknown, fallback: string) => {
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Keep the safe fallback below.
    }
  }
  return messageFromUnknown(error) || fallback;
};

// ── Payload & poster validation ──────────────────────────────────────────────
export const buildEventPayloadFromDraft = (draft: EventDraft): EventPayload => {
  const title = stripHtmlText(draft.title);
  const description = stripHtmlText(draft.description);
  const location = stripHtmlText(draft.location);
  const start = new Date(`${draft.eventDate}T${draft.eventTime}:00`);
  const end = draft.endTime ? new Date(`${draft.eventDate}T${draft.endTime}:00`) : null;

  const payload: EventPayload = {
    title,
    description: description || null,
    location: location || null,
    event_date: start.toISOString(),
    end_date: end?.toISOString() ?? null,
    poster_url: draft.posterUrl,
  };

  // Only write the jsonb columns when the caller supplied them. EventForm omits
  // them, so its updates leave any existing media/setlist intact (insert falls back
  // to the column's '[]' default). Validate/strip when present — the form is the
  // first gate, this is the net.
  if (draft.media !== undefined) payload.media = parseMediaItems(draft.media);
  if (draft.setlist !== undefined) payload.setlist = parseSetlistEntries(draft.setlist);

  return payload;
};

export const validatePosterBlob = (blob: Blob) => {
  if (blob.size > MAX_EVENT_POSTER_BYTES) {
    throw new Error("Poster image must be 5MB or smaller.");
  }
  if (blob.type !== "image/jpeg") {
    throw new Error("Poster image must be a JPEG image.");
  }
};

const createPosterPath = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

const POSTER_BUCKET = "event-posters";

// The DB stores the poster's full public URL; the orphan-delete needs the bucket
// object path. Pull out everything after the bucket segment, dropping any query
// string. Returns null for anything not in our bucket so we never attempt to
// remove an unrecognized object.
export const posterPathFromUrl = (url: string | null): string | null => {
  if (!url) return null;
  const marker = `/${POSTER_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length).split("?")[0];
  return path || null;
};

// In-flow orphan cleanup. Best-effort by design: removing the old object must
// never block or fail the primary write — a lingering file is harmless and rare,
// and deletion is gated by the admin storage RLS policy.
const removePosterObject = async (url: string | null) => {
  const path = posterPathFromUrl(url);
  if (!path) return;
  try {
    await supabase.storage.from(POSTER_BUCKET).remove([path]);
  } catch {
    // Swallow — orphan cleanup is opportunistic, not load-bearing.
  }
};

// ── Reads (public) ───────────────────────────────────────────────────────────
export const loadEvents = async ({ limit = 100 }: { limit?: number } = {}) => {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("event_date", { ascending: true })
    .limit(limit);

  if (error) throwEventError(error, "Could not load events.");
  return ((data ?? []) as RawEventRow[]).map(normalizeEventRow);
};

// Single event for the /media detail page. Returns null when the id doesn't
// resolve (deleted event / bad URL) so the page can show a not-found state.
export const loadEventById = async (id: string): Promise<EventItem | null> => {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (error) throwEventError(error, "Could not load event.");
  return data ? normalizeEventRow(data as RawEventRow) : null;
};

// ── Admin writes (assume a verified session) ─────────────────────────────────
export const uploadEventPoster = async (blob: Blob): Promise<EventPosterUploadResult> => {
  // Assumes caller has already verified an admin session.
  try {
    validatePosterBlob(blob);
    const formData = new FormData();
    formData.append("kind", "event-poster");
    formData.append("file", blob, createPosterPath());
    const { data, error } = await supabase.functions.invoke("upload-admin-file", {
      body: formData,
    });
    if (error) {
      const message = await readFunctionErrorMessage(error, "Could not upload poster.");
      throw new Error(message);
    }
    if (!data || typeof data !== "object" || typeof (data as { publicUrl?: unknown }).publicUrl !== "string") {
      throw new Error("Could not upload poster.");
    }
    return { publicUrl: (data as { publicUrl: string }).publicUrl };
  } catch (error: unknown) {
    return throwEventError(error, "Could not upload poster.");
  }
};

export const saveEvent = async ({ editingId, draft }: SaveEventInput) => {
  // Assumes caller has already verified an admin session.
  const payload = buildEventPayloadFromDraft(draft);

  // Capture the persisted poster before the update so we can delete it in-flow if
  // the edit replaced it with a new one (or removed it entirely).
  let previousPosterUrl: string | null = null;
  if (editingId) {
    const { data } = await supabase.from("events").select("poster_url").eq("id", editingId).maybeSingle();
    previousPosterUrl = (data as { poster_url: string | null } | null)?.poster_url ?? null;
  }

  const query = editingId
    ? supabase.from("events").update(payload).eq("id", editingId)
    : supabase.from("events").insert(payload);

  const { error } = await query;
  if (error) throwEventError(error, "Could not save event.");

  if (editingId && previousPosterUrl && previousPosterUrl !== payload.poster_url) {
    await removePosterObject(previousPosterUrl);
  }
};

// Focused write for the detail page's inline media/setlist editor — touches only
// the two jsonb columns, leaving event basics (managed by EventForm) untouched.
// Re-validates/strips on the way in, same as a full save. Assumes a verified
// admin session.
export const updateEventMedia = async (
  eventId: string,
  input: { media: MediaItem[]; setlist: SetlistEntry[] },
) => {
  const { error } = await supabase
    .from("events")
    .update({
      media: parseMediaItems(input.media),
      setlist: parseSetlistEntries(input.setlist),
    })
    .eq("id", eventId);
  if (error) throwEventError(error, "Could not save media.");
};

export const deleteEvent = async (eventId: string) => {
  // Assumes caller has already verified an admin session. Return the deleted row's
  // poster so we can remove the now-orphaned object in-flow.
  const { data, error } = await supabase.from("events").delete().eq("id", eventId).select("poster_url").maybeSingle();
  if (error) throwEventError(error, "Could not delete event.");
  await removePosterObject((data as { poster_url: string | null } | null)?.poster_url ?? null);
};
