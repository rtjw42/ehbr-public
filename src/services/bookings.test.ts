import { describe, expect, it, vi, beforeEach } from "vitest";
import { supabaseMock, queryResult, resetSupabaseMock } from "@/test/supabase-mock";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import {
  buildBookingRowsFromIntent,
  normalizeBookingError,
  readFunctionErrorMessage,
  loadApprovedBookingsForWindow,
  loadTodayApprovedBookings,
  loadAdminBookings,
  submitPublicBookingRequest,
  createApprovedAdminBookings,
  updateBooking,
  approveBooking,
  approveBookingGroup,
  deletePendingBooking,
  deleteBooking,
  deleteBookingAndFollowingOccurrences,
  deleteBookingSeries,
} from "./bookings";

const intent = {
  title: "Practice",
  name: "Bandit",
  info: null,
  start: new Date("2026-05-08T11:00:00.000Z"),
  end: new Date("2026-05-08T13:00:00.000Z"),
  recurrence: "none" as const,
  recurrenceEnd: null,
  rgb: [10, 20, 30] as [number, number, number],
};

beforeEach(() => resetSupabaseMock());

describe("buildBookingRowsFromIntent", () => {
  it("builds one row for non-recurring intent", () => {
    expect(buildBookingRowsFromIntent(intent)).toEqual([
      { start_time: "2026-05-08T11:00:00.000Z", end_time: "2026-05-08T13:00:00.000Z" },
    ]);
  });

  it("expands weekly recurrence up to the end date (inclusive)", () => {
    const rows = buildBookingRowsFromIntent({
      start: new Date(2026, 4, 8, 19),
      end: new Date(2026, 4, 8, 21),
      recurrence: "weekly",
      recurrenceEnd: "2026-05-22",
    });
    expect(rows).toHaveLength(3);
  });

  it("returns a single row when recurrence is set but no end date", () => {
    const rows = buildBookingRowsFromIntent({
      start: new Date(2026, 4, 8, 19),
      end: new Date(2026, 4, 8, 21),
      recurrence: "weekly",
      recurrenceEnd: null,
    });
    expect(rows).toHaveLength(1);
  });

  it("builds one row per custom date, chronologically sorted, reusing the shared time-of-day", () => {
    const rows = buildBookingRowsFromIntent({
      start: new Date(2026, 4, 8, 19), // 19:00 local (placeholder date is irrelevant)
      end: new Date(2026, 4, 8, 21),   // 2h duration
      recurrence: "none",
      recurrenceEnd: null,
      // Deliberately unsorted (tap order) — the builder must sort chronologically.
      customDates: ["2026-05-15", "2026-05-20", "2026-05-10"],
    });
    expect(rows).toEqual([
      { start_time: new Date(2026, 4, 10, 19).toISOString(), end_time: new Date(2026, 4, 10, 21).toISOString() },
      { start_time: new Date(2026, 4, 15, 19).toISOString(), end_time: new Date(2026, 4, 15, 21).toISOString() },
      { start_time: new Date(2026, 4, 20, 19).toISOString(), end_time: new Date(2026, 4, 20, 21).toISOString() },
    ]);
  });

  it("preserves a cross-midnight duration on each custom date", () => {
    const rows = buildBookingRowsFromIntent({
      start: new Date(2026, 4, 8, 23),    // 23:00
      end: new Date(2026, 4, 9, 1),       // 01:00 next day → 2h, crosses midnight
      recurrence: "none",
      recurrenceEnd: null,
      customDates: ["2026-06-01"],
    });
    expect(rows).toEqual([
      { start_time: new Date(2026, 5, 1, 23).toISOString(), end_time: new Date(2026, 5, 2, 1).toISOString() },
    ]);
  });

  it("falls back to the single/recurrence path when customDates is empty", () => {
    const rows = buildBookingRowsFromIntent({ ...intent, customDates: [] });
    expect(rows).toEqual([
      { start_time: "2026-05-08T11:00:00.000Z", end_time: "2026-05-08T13:00:00.000Z" },
    ]);
  });
});

describe("normalizeBookingError", () => {
  it.each([
    ["rate limit, try again later", "Too many booking requests. Please try again later."],
    ["turnstile verification failed", "Verification failed or expired. Please complete the challenge again."],
    ["info must be 400 characters", "Info must be 400 characters or fewer."],
    ["violates exclude constraint no_approved_overlap", "That time is no longer available."],
    // Punctuated to match validation.endAfterStart, so client- and server-caught
    // versions of the same problem read identically.
    ["End time must be after start time", "End time must be after start time."],
  ])("maps %s", (input, expected) => {
    expect(normalizeBookingError(input, "fallback")).toBe(expected);
  });

  // These reached the user as a bare "Could not submit booking request." before —
  // the server states the real reason, and the client threw it away.
  it.each([
    "Booking title is required and must be 100 characters or fewer",
    "Booking date must be within the next 18 months",
    "A single session must be shorter than 7 days",
    "Booking request must include between 1 and 60 sessions",
    "Each session must have a start and end time",
  ])("surfaces the request-bound rejection: %s", (input) => {
    expect(normalizeBookingError(input, "fallback")).toBe(input);
  });

  it("falls back for unknown errors without leaking detail", () => {
    expect(normalizeBookingError({ message: "raw pg detail" }, "Could not save booking."))
      .toBe("Could not save booking.");
  });
});

describe("readFunctionErrorMessage", () => {
  it("reads a structured edge error body", async () => {
    const response = new Response(JSON.stringify({ error: "boom" }));
    expect(await readFunctionErrorMessage({ context: response }, "fallback")).toBe("boom");
  });

  it("falls back when the body is unreadable", async () => {
    expect(await readFunctionErrorMessage({ context: new Response("not json") }, "fallback")).toBe("fallback");
  });
});

describe("reads", () => {
  it("loads approved bookings for a window and returns rows", async () => {
    const rows = [{ id: "1", status: "approved", approved_by: "u1", approved_by_profile: { display_name: "Ryan" } }];
    supabaseMock.from.mockReturnValue(queryResult({ data: rows, error: null }));
    const result = await loadApprovedBookingsForWindow({ startTime: 0, endTime: 1000 });
    expect(supabaseMock.from).toHaveBeenCalledWith("bookings");
    // The admin_profiles embed is flattened onto approved_by_name; no booking_groups
    // embed on public reads, so group_kind flattens to null.
    expect(result).toEqual([{ id: "1", status: "approved", approved_by: "u1", approved_by_name: "Ryan", group_kind: null }]);
  });

  it("flattens the booking_groups embed onto group_kind on admin reads", async () => {
    const rows = [
      { id: "1", group_id: "g1", booking_group: { kind: "custom" }, start_time: "2026-05-01T10:00:00.000Z" },
      { id: "2", group_id: "g2", booking_group: { kind: "pattern" }, start_time: "2026-05-02T10:00:00.000Z" },
      { id: "3", group_id: null, booking_group: null, start_time: "2026-05-03T10:00:00.000Z" },
    ];
    // Admin reads run TWO queries (pending, then decided) with separate budgets.
    supabaseMock.from
      .mockReturnValueOnce(queryResult({ data: rows, error: null }))
      .mockReturnValueOnce(queryResult({ data: [], error: null }));
    const result = await loadAdminBookings();
    expect(result.map((b) => b.group_kind)).toEqual(["custom", "pattern", null]);
  });

  it("merges the pending and decided admin queries in chronological order", async () => {
    // The two queries carry independent row budgets so neither status can evict the
    // other (only `pending` is publicly writable). The merged array must still reach
    // callers in one chronological order — every admin view filters this one array.
    supabaseMock.from
      .mockReturnValueOnce(queryResult({
        data: [{ id: "p", status: "pending", start_time: "2026-05-02T10:00:00.000Z" }],
        error: null,
      }))
      .mockReturnValueOnce(queryResult({
        data: [
          { id: "a1", status: "approved", start_time: "2026-05-01T10:00:00.000Z" },
          { id: "a2", status: "approved", start_time: "2026-05-03T10:00:00.000Z" },
        ],
        error: null,
      }));
    const result = await loadAdminBookings();
    expect(result.map((b) => b.id)).toEqual(["a1", "p", "a2"]);
  });

  it("returns [] when data is null", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: null }));
    expect(await loadTodayApprovedBookings()).toEqual([]);
  });

  it("throws a normalized error on failure", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: { message: "db down" } }));
    await expect(loadAdminBookings()).rejects.toThrow("Could not load bookings.");
  });
});

describe("public request path", () => {
  it("submits a sanitized booking through the edge function", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await submitPublicBookingRequest({ ...intent, name: "<b>Bandit</b>", turnstileToken: "tok" });
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith(
      "submit-booking",
      expect.objectContaining({
        body: expect.objectContaining({
          turnstileToken: "tok",
          booking: expect.objectContaining({ name: "Bandit" }),
        }),
      }),
    );
    expect(result).toEqual({ sessionCount: 1 });
  });

  it("throws a normalized error when the response carries an error field", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { error: "too many booking requests" }, error: null });
    await expect(submitPublicBookingRequest({ ...intent, turnstileToken: "t" }))
      .rejects.toThrow("Too many booking requests. Please try again later.");
  });

  it("honors the edge error contract from the invoke error context", async () => {
    const response = new Response(JSON.stringify({ error: "no_approved_overlap" }));
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: { context: response } });
    await expect(submitPublicBookingRequest({ ...intent, turnstileToken: "t" }))
      .rejects.toThrow("That time is no longer available.");
  });
});

describe("admin writes", () => {
  it("creates an approved series via the RPC with a sanitized payload", async () => {
    supabaseMock.rpc.mockReturnValue(queryResult({ data: [{ id: "1" }], error: null }));
    const result = await createApprovedAdminBookings({ ...intent, name: "<i>x</i>" });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "create_approved_booking_series",
      expect.objectContaining({ payload: expect.objectContaining({ name: "x" }) }),
    );
    expect(result).toEqual([{ id: "1", approved_by_name: null }]);
  });

  it("updates a booking and returns the row", async () => {
    const updated = { id: "b1", name: "n" };
    supabaseMock.from.mockReturnValue(queryResult({ data: updated, error: null }));
    const result = await updateBooking({ id: "b1", title: "t", name: "n", info: null, start: intent.start, end: intent.end, rgb: intent.rgb });
    expect(result).toEqual({ ...updated, approved_by_name: null, group_kind: null });
  });
});

describe("approvals", () => {
  it("calls approve_booking", async () => {
    supabaseMock.rpc.mockReturnValue(queryResult({ data: null, error: null }));
    await approveBooking("b1");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("approve_booking", { _booking_id: "b1" });
  });

  it("calls approve_booking_group for atomic group approval", async () => {
    supabaseMock.rpc.mockReturnValue(queryResult({ data: null, error: null }));
    await approveBookingGroup("g1");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("approve_booking_group", { _group_id: "g1" });
  });

  it("throws a normalized error when group approval fails", async () => {
    supabaseMock.rpc.mockReturnValue(queryResult({ data: null, error: { message: "nope" } }));
    await expect(approveBookingGroup("g1")).rejects.toThrow("Could not approve booking.");
  });

  it("throws a normalized error when approval fails", async () => {
    supabaseMock.rpc.mockReturnValue(queryResult({ data: null, error: { message: "nope" } }));
    await expect(approveBooking("b1")).rejects.toThrow("Could not approve booking.");
  });
});

describe("deletes", () => {
  it("deletes a pending booking filtered by id and status", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await deletePendingBooking("b1");
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "b1");
    expect(builder.eq).toHaveBeenCalledWith("status", "pending");
  });

  it("deletes a single booking by id", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await deleteBooking("b1");
    expect(builder.eq).toHaveBeenCalledWith("id", "b1");
  });

  it("deletes this and following occurrences by group + start time", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await deleteBookingAndFollowingOccurrences("g1", "2026-05-08T11:00:00.000Z");
    expect(builder.eq).toHaveBeenCalledWith("group_id", "g1");
    expect(builder.gte).toHaveBeenCalledWith("start_time", "2026-05-08T11:00:00.000Z");
  });

  it("deletes a whole series by group id", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await deleteBookingSeries("g1");
    expect(builder.eq).toHaveBeenCalledWith("group_id", "g1");
  });

  it("throws a normalized error when a delete fails", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: { message: "fk" } }));
    await expect(deleteBooking("b1")).rejects.toThrow("Could not delete booking.");
  });
});
