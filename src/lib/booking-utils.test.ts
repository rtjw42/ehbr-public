import { describe, expect, it, vi } from "vitest";
import {
  bookingsForDay,
  mergeVisibleApprovedBookings,
  expandRecurrence,
  overlaps,
  bookingIntersectsWindow,
  dispatchBookingApprovedChanged,
  nextAvailableSlot,
  snapUpTo15,
  BOOKING_APPROVED_CHANGED_EVENT,
  clampStartToFloor,
  type Booking,
} from "@/lib/booking-utils";

const booking = (overrides: Partial<Booking> & Pick<Booking, "id" | "start_time" | "end_time">): Booking => ({
  group_id: null,
  title: "Practice",
  name: "Band",
  info: null,
  color_r: 120,
  color_g: 120,
  color_b: 120,
  status: "approved",
  approved_by: null,
  approved_by_name: null,
  ...overrides,
});

describe("mergeVisibleApprovedBookings", () => {
  const windowStart = new Date("2026-05-18T00:00:00.000Z").getTime();
  const windowEnd = new Date("2026-05-25T23:59:59.999Z").getTime();

  it("dedupes incoming bookings by id and sorts by start time", () => {
    const existing = [
      booking({ id: "later", start_time: "2026-05-20T10:00:00.000Z", end_time: "2026-05-20T12:00:00.000Z" }),
    ];
    const incoming = [
      booking({ id: "earlier", start_time: "2026-05-19T10:00:00.000Z", end_time: "2026-05-19T12:00:00.000Z" }),
      booking({ id: "later", name: "Updated", start_time: "2026-05-21T10:00:00.000Z", end_time: "2026-05-21T12:00:00.000Z" }),
    ];

    expect(mergeVisibleApprovedBookings(existing, incoming, windowStart, windowEnd).map((item) => [item.id, item.name])).toEqual([
      ["earlier", "Band"],
      ["later", "Updated"],
    ]);
  });

  it("filters incoming non-approved bookings and bookings outside the visible window", () => {
    const merged = mergeVisibleApprovedBookings(
      [],
      [
        booking({ id: "pending", status: "pending", start_time: "2026-05-19T10:00:00.000Z", end_time: "2026-05-19T12:00:00.000Z" }),
        booking({ id: "outside", start_time: "2026-05-29T10:00:00.000Z", end_time: "2026-05-29T12:00:00.000Z" }),
        booking({ id: "inside", start_time: "2026-05-19T10:00:00.000Z", end_time: "2026-05-19T12:00:00.000Z" }),
      ],
      windowStart,
      windowEnd,
    );

    expect(merged.map((item) => item.id)).toEqual(["inside"]);
  });

  it("removes an existing visible booking when an updated row moves outside the window", () => {
    const existing = [
      booking({ id: "moved", start_time: "2026-05-19T10:00:00.000Z", end_time: "2026-05-19T12:00:00.000Z" }),
    ];
    const incoming = [
      booking({ id: "moved", start_time: "2026-05-30T10:00:00.000Z", end_time: "2026-05-30T12:00:00.000Z" }),
    ];

    expect(mergeVisibleApprovedBookings(existing, incoming, windowStart, windowEnd)).toEqual([]);
  });
});

describe("bookingsForDay", () => {
  const localIso = (year: number, month: number, day: number, hour: number, minute = 0) =>
    new Date(year, month - 1, day, hour, minute).toISOString();

  it("does not show a booking on the next day when it ends exactly at midnight", () => {
    const items = bookingsForDay([
      booking({
        id: "midnight-end",
        start_time: localIso(2026, 5, 18, 22),
        end_time: localIso(2026, 5, 19, 0),
      }),
    ], new Date(2026, 4, 19));

    expect(items).toEqual([]);
  });

  it("shows a real overnight booking on the next day when it ends after midnight", () => {
    const items = bookingsForDay([
      booking({
        id: "overnight",
        start_time: localIso(2026, 5, 18, 22),
        end_time: localIso(2026, 5, 19, 0, 30),
      }),
    ], new Date(2026, 4, 19));

    expect(items.map((item) => [item.booking.id, item.isContinued])).toEqual([["overnight", true]]);
  });
});

describe("expandRecurrence", () => {
  const start = new Date(2026, 4, 8, 19);
  const end = new Date(2026, 4, 8, 21);

  it("returns a single instance for non-recurring or missing end date", () => {
    expect(expandRecurrence(start, end, "none", new Date(2026, 5, 8))).toHaveLength(1);
    expect(expandRecurrence(start, end, "weekly", null)).toHaveLength(1);
  });

  it("expands weekly up to the inclusive end date", () => {
    expect(expandRecurrence(start, end, "weekly", new Date(2026, 4, 29, 23))).toHaveLength(4);
  });

  it("caps runaway expansion at the 366 safety limit", () => {
    const farFuture = new Date(2040, 0, 1);
    expect(expandRecurrence(start, end, "weekly", farFuture)).toHaveLength(366);
  });
});

describe("overlaps / bookingIntersectsWindow", () => {
  it("treats touching edges as non-overlapping", () => {
    const a = new Date("2026-05-08T10:00:00Z");
    const mid = new Date("2026-05-08T11:00:00Z");
    const b = new Date("2026-05-08T12:00:00Z");
    expect(overlaps(a, mid, mid, b)).toBe(false);
    expect(overlaps(a, b, mid, b)).toBe(true);
  });

  it("detects window intersection from ISO booking times", () => {
    const booking = { start_time: "2026-05-08T11:00:00.000Z", end_time: "2026-05-08T13:00:00.000Z" };
    const start = new Date("2026-05-08T12:00:00Z").getTime();
    const end = new Date("2026-05-08T14:00:00Z").getTime();
    expect(bookingIntersectsWindow(booking, start, end)).toBe(true);
    expect(bookingIntersectsWindow(booking, new Date("2026-05-09T00:00:00Z").getTime(), end)).toBe(false);
  });
});

describe("dispatchBookingApprovedChanged", () => {
  it("dispatches when there is a payload and stays silent when empty", () => {
    const handler = vi.fn();
    window.addEventListener(BOOKING_APPROVED_CHANGED_EVENT, handler);

    dispatchBookingApprovedChanged({ deletedIds: [] });
    expect(handler).not.toHaveBeenCalled();

    dispatchBookingApprovedChanged({ deletedIds: ["b1"] });
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener(BOOKING_APPROVED_CHANGED_EVENT, handler);
  });
});

describe("snapUpTo15", () => {
  const hm = (d: Date): [number, number, number, number] => [d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];

  it("rounds up to the next quarter hour and drops seconds/millis", () => {
    expect(hm(snapUpTo15(new Date(2026, 4, 18, 14, 7, 30, 500)))).toEqual([14, 15, 0, 0]);
  });

  it("leaves an already-aligned time unchanged", () => {
    expect(hm(snapUpTo15(new Date(2026, 4, 18, 14, 30, 0, 0)))).toEqual([14, 30, 0, 0]);
  });

  it("rolls into the next hour", () => {
    expect(hm(snapUpTo15(new Date(2026, 4, 18, 14, 50)))).toEqual([15, 0, 0, 0]);
  });
});

describe("nextAvailableSlot", () => {
  const now = new Date(2026, 4, 18, 14, 7); // 14:07 local
  const twoHours = 2 * 3_600_000;
  const hm = (d: Date): [number, number] => [d.getHours(), d.getMinutes()];

  it("returns the next 15-min boundary when nothing clashes", () => {
    expect(hm(nextAvailableSlot(now, [], twoHours))).toEqual([14, 15]);
  });

  it("jumps past a clashing booking to its end", () => {
    const b = booking({
      id: "clash",
      start_time: new Date(2026, 4, 18, 14, 0).toISOString(),
      end_time: new Date(2026, 4, 18, 16, 0).toISOString(),
    });
    expect(hm(nextAvailableSlot(now, [b], twoHours))).toEqual([16, 0]);
  });

  it("finds a gap that fits the full duration between two bookings", () => {
    const bookings = [
      booking({ id: "a", start_time: new Date(2026, 4, 18, 14, 0).toISOString(), end_time: new Date(2026, 4, 18, 15, 0).toISOString() }),
      booking({ id: "b", start_time: new Date(2026, 4, 18, 17, 0).toISOString(), end_time: new Date(2026, 4, 18, 19, 0).toISOString() }),
    ];
    // 14:15 clashes with a; jump to 15:00; [15:00,17:00) is free (touches b at 17:00).
    expect(hm(nextAvailableSlot(now, bookings, twoHours))).toEqual([15, 0]);
  });
});

// ── Regression: the start floor must be an INVARIANT ─────────────────────────
// Bug (owner-reported): on today the wheel greys past times, but switching to a
// LATER date removed the floor, letting an early time be picked — and switching
// back to today left that past time selected. The wheel's own clamp lives in its
// commit(), which only runs while spinning, so nothing re-applied the floor.
describe("clampStartToFloor", () => {
  const TODAY = "2026-08-21";
  const FLOOR = "14:30";

  it("lifts a time that fell below the floor to the floor", () => {
    expect(clampStartToFloor("09:00", TODAY, TODAY, FLOOR)).toBe(FLOOR);
  });

  it("is exactly the date-hop case: pick 09:00 on a later day, return to today", () => {
    const chosenOnAnotherDay = "09:00";
    expect(clampStartToFloor(chosenOnAnotherDay, "2026-08-22", TODAY, FLOOR)).toBe("09:00");
    expect(clampStartToFloor(chosenOnAnotherDay, TODAY, TODAY, FLOOR)).toBe(FLOOR);
  });

  it("leaves a time at or after the floor untouched", () => {
    expect(clampStartToFloor(FLOOR, TODAY, TODAY, FLOOR)).toBe(FLOOR);
    expect(clampStartToFloor("23:45", TODAY, TODAY, FLOOR)).toBe("23:45");
  });

  it("applies no floor on any day other than the earliest bookable one", () => {
    expect(clampStartToFloor("00:00", "2026-08-22", TODAY, FLOOR)).toBe("00:00");
  });

  it("compares midnight correctly (00:00 is the lowest time of its day)", () => {
    expect(clampStartToFloor("00:00", TODAY, TODAY, FLOOR)).toBe(FLOOR);
    expect(clampStartToFloor("00:00", TODAY, TODAY, "00:00")).toBe("00:00");
  });

  it("passes an empty time through rather than inventing one", () => {
    expect(clampStartToFloor("", TODAY, TODAY, FLOOR)).toBe("");
  });
});
