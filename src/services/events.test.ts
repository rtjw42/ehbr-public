import { describe, expect, it, vi, beforeEach } from "vitest";
import { supabaseMock, queryResult, resetSupabaseMock } from "@/test/supabase-mock";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import {
  buildEventPayloadFromDraft,
  normalizeEventError,
  validatePosterBlob,
  loadEvents,
  loadEventById,
  uploadEventPoster,
  saveEvent,
  deleteEvent,
  posterPathFromUrl,
} from "./events";

beforeEach(() => resetSupabaseMock());

describe("event service helpers", () => {
  it("builds an event payload from draft values, omitting media/setlist when absent", () => {
    const payload = buildEventPayloadFromDraft({
      title: "Test Event",
      description: "Just a test",
      location: "EH Band Room",
      eventDate: "2026-05-08",
      eventTime: "19:00",
      endTime: "21:00",
      posterUrl: "https://example.com/poster.jpg",
    });

    // No media/setlist keys when the draft omits them — so a basics-only edit never
    // overwrites an event's existing media/setlist jsonb columns.
    expect(payload).toEqual({
      title: "Test Event",
      description: "Just a test",
      location: "EH Band Room",
      event_date: new Date("2026-05-08T19:00:00").toISOString(),
      end_date: new Date("2026-05-08T21:00:00").toISOString(),
      poster_url: "https://example.com/poster.jpg",
    });
    expect("media" in payload).toBe(false);
    expect("setlist" in payload).toBe(false);
  });

  it("validates and strips media/setlist when building the payload", () => {
    const payload = buildEventPayloadFromDraft({
      title: "Gig",
      description: "",
      location: "",
      eventDate: "2026-05-08",
      eventTime: "19:00",
      posterUrl: null,
      media: [
        { type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
        { type: "photo_album", url: "javascript:alert(1)" },
      ],
      setlist: [
        { title: "Song A", spotify: "https://open.spotify.com/track/1", apple: "not-a-url" },
      ],
    });

    expect(payload.media).toEqual([{ type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" }]);
    expect(payload.setlist).toEqual([{ title: "Song A", spotify: "https://open.spotify.com/track/1" }]);
  });

  it("strips HTML and coerces blank optional fields to null", () => {
    const payload = buildEventPayloadFromDraft({
      title: "<strong>Clean</strong> Event",
      description: "<img src=x onerror=alert(1)>",
      location: "   ",
      eventDate: "2026-05-08",
      eventTime: "19:00",
      posterUrl: null,
    });

    expect(payload.title).toBe("Clean Event");
    expect(payload.description).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.end_date).toBeNull();
  });

  it("normalizes event errors to safe messages", () => {
    expect(normalizeEventError("file size too large", "fallback")).toBe("Poster image must be 5MB or smaller.");
    expect(normalizeEventError("invalid MIME content type", "fallback")).toBe("Poster image must be a JPEG image.");
    expect(normalizeEventError({ message: "raw database detail" }, "Could not save event.")).toBe("Could not save event.");
  });

  it("validates poster blobs by size and type", () => {
    expect(() => validatePosterBlob(new Blob(["poster"], { type: "image/jpeg" }))).not.toThrow();
    expect(() => validatePosterBlob(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/jpeg" })))
      .toThrow("Poster image must be 5MB or smaller.");
    expect(() => validatePosterBlob(new Blob(["poster"], { type: "image/png" })))
      .toThrow("Poster image must be a JPEG image.");
  });
});

describe("loadEvents", () => {
  it("returns rows ordered by date with normalized media/setlist", async () => {
    const rows = [{ id: "e1" }];
    supabaseMock.from.mockReturnValue(queryResult({ data: rows, error: null }));
    expect(await loadEvents()).toEqual([{ id: "e1", media: [], setlist: [] }]);
    expect(supabaseMock.from).toHaveBeenCalledWith("events");
  });

  it("re-validates jsonb media/setlist on read, dropping bad entries", async () => {
    const rows = [
      {
        id: "e1",
        media: [
          { type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
          { type: "youtube", url: "https://evil.com/watch?v=dQw4w9WgXcQ" },
        ],
        setlist: [{ title: "Song", apple: "javascript:alert(1)" }],
      },
    ];
    supabaseMock.from.mockReturnValue(queryResult({ data: rows, error: null }));
    const [event] = await loadEvents();
    expect(event.media).toEqual([{ type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" }]);
    expect(event.setlist).toEqual([{ title: "Song" }]);
  });
});

describe("loadEventById", () => {
  it("normalizes and returns a single event", async () => {
    const row = { id: "e1", media: [{ type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" }], setlist: [] };
    const builder = queryResult({ data: row, error: null });
    supabaseMock.from.mockReturnValue(builder);
    const event = await loadEventById("e1");
    expect(builder.eq).toHaveBeenCalledWith("id", "e1");
    expect(event?.media).toEqual([{ type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" }]);
  });

  it("returns null when the event does not resolve", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: null }));
    expect(await loadEventById("missing")).toBeNull();
  });

  it("throws a normalized error on failure", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: { message: "db" } }));
    await expect(loadEventById("e1")).rejects.toThrow("Could not load event.");
  });

  it("throws a normalized error on failure", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: { message: "db" } }));
    await expect(loadEvents()).rejects.toThrow("Could not load events.");
  });
});

describe("uploadEventPoster", () => {
  it("uploads a JPEG through the edge function and returns the public URL", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { publicUrl: "https://cdn/x.jpg" }, error: null });
    const result = await uploadEventPoster(new Blob(["poster"], { type: "image/jpeg" }));
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith("upload-admin-file", expect.any(Object));
    expect(result).toEqual({ publicUrl: "https://cdn/x.jpg" });
  });

  it("rejects a non-JPEG before invoking the edge function", async () => {
    await expect(uploadEventPoster(new Blob(["x"], { type: "image/png" })))
      .rejects.toThrow("Poster image must be a JPEG image.");
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled();
  });

  it("throws when the edge response lacks a public URL", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: {}, error: null });
    await expect(uploadEventPoster(new Blob(["poster"], { type: "image/jpeg" })))
      .rejects.toThrow("Could not upload poster.");
  });
});

describe("posterPathFromUrl", () => {
  it("extracts the bucket object path and strips any query string", () => {
    expect(posterPathFromUrl("https://x.supabase.co/storage/v1/object/public/event-posters/123-ab.jpg")).toBe("123-ab.jpg");
    expect(posterPathFromUrl("https://x.supabase.co/storage/v1/object/public/event-posters/123-ab.jpg?t=1")).toBe("123-ab.jpg");
  });

  it("returns null for anything outside our bucket", () => {
    expect(posterPathFromUrl(null)).toBeNull();
    expect(posterPathFromUrl("https://example.com/other/file.jpg")).toBeNull();
    expect(posterPathFromUrl("https://x.supabase.co/storage/v1/object/public/event-posters/")).toBeNull();
  });
});

describe("saveEvent / deleteEvent", () => {
  it("inserts a new event", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await saveEvent({ draft: { title: "T", description: "", location: "", eventDate: "2026-05-08", eventTime: "19:00", posterUrl: null } });
    expect(builder.insert).toHaveBeenCalled();
  });

  it("updates an existing event by id", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await saveEvent({ editingId: "e1", draft: { title: "T", description: "", location: "", eventDate: "2026-05-08", eventTime: "19:00", posterUrl: null } });
    expect(builder.update).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "e1");
  });

  it("deletes an event by id", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await deleteEvent("e1");
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "e1");
  });

  it("removes the previous poster object in-flow when an edit replaces it", async () => {
    const oldUrl = "https://x.supabase.co/storage/v1/object/public/event-posters/old.jpg";
    supabaseMock.from.mockReturnValue(queryResult({ data: { poster_url: oldUrl }, error: null }));
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    supabaseMock.storage.from.mockReturnValue({ remove });

    await saveEvent({
      editingId: "e1",
      draft: { title: "T", description: "", location: "", eventDate: "2026-05-08", eventTime: "19:00", posterUrl: null },
    });

    expect(supabaseMock.storage.from).toHaveBeenCalledWith("event-posters");
    expect(remove).toHaveBeenCalledWith(["old.jpg"]);
  });

  it("removes the orphaned poster object after deleting an event", async () => {
    const url = "https://x.supabase.co/storage/v1/object/public/event-posters/1234-ab.jpg";
    supabaseMock.from.mockReturnValue(queryResult({ data: { poster_url: url }, error: null }));
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    supabaseMock.storage.from.mockReturnValue({ remove });

    await deleteEvent("e1");

    expect(remove).toHaveBeenCalledWith(["1234-ab.jpg"]);
  });
});
