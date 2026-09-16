// Tables for the Edge Functions' error boundary. The source lives in
// supabase/functions/_shared so Deno and Vitest import the exact same file. The
// property under test: a message reaches a caller only because of WHERE it came
// from (a PublicError we threw, or a RAISE in one of our RPCs) — never because
// of what the text happens to contain.
import { describe, expect, it } from "vitest";
import {
  PublicError,
  SLOT_TAKEN,
  VERIFICATION_FAILED,
  publicError,
  rpcError,
} from "../../supabase/functions/_shared/public-error.ts";

const FALLBACK = "Could not submit booking request.";

describe("rpcError", () => {
  it.each([
    // Every RAISE in the submit_booking_request migration is P0001 and ours to show.
    ["Booking title is required and must be 100 characters or fewer", 400],
    ["Invalid booking color", 400],
    ["Booking request must include between 1 and 60 sessions", 400],
    ["End time must be after start time", 400],
    ["Booking date must be within the next 18 months", 400],
    ["Requested time overlaps an approved booking", 409],
    ["You have too many pending booking requests.", 429],
  ])("forwards a P0001 %p as a PublicError with status %i", (message, status) => {
    const error = rpcError({ code: "P0001", message });
    expect(error).toBeInstanceOf(PublicError);
    expect(error.message).toBe(message);
    expect((error as PublicError).status).toBe(status);
  });

  it("turns an exclusion-constraint violation (23P01) into the stable slot-taken message", () => {
    const error = rpcError({
      code: "23P01",
      message: 'conflicting key value violates exclusion constraint "no_approved_overlap"',
    });
    expect(error).toBeInstanceOf(PublicError);
    expect(error.message).toBe(SLOT_TAKEN);
    expect((error as PublicError).status).toBe(409);
  });

  it.each([
    // The messages the old keyword allow-list let through verbatim: they contain
    // "invalid" / "must" / "after", and none of them are ours.
    ["22P02", 'invalid input syntax for type uuid: "abc"'],
    ["22P02", 'invalid input syntax for type timestamp with time zone: "later"'],
    ["23502", 'null value in column "start_time" violates not-null constraint'],
    ["42883", "operator does not exist: text + integer"],
    ["42703", 'column "after" must appear in the GROUP BY clause'],
  ])("keeps a Postgres-internal %s a plain Error so the caller sees the fallback", (code, message) => {
    const error = rpcError({ code, message });
    expect(error).not.toBeInstanceOf(PublicError);
    expect(error.message).toContain(code); // diagnosable in the function logs
    expect(publicError(error, FALLBACK)).toEqual({ message: FALLBACK, status: 500 });
  });

  it("does not trust P0001 with an empty message", () => {
    expect(rpcError({ code: "P0001", message: "" })).not.toBeInstanceOf(PublicError);
    expect(rpcError({ code: "P0001", message: null })).not.toBeInstanceOf(PublicError);
  });

  it("does not trust a missing code", () => {
    expect(rpcError({ message: "Invalid booking color" })).not.toBeInstanceOf(PublicError);
  });
});

describe("publicError", () => {
  it("forwards a PublicError's message and status", () => {
    expect(publicError(new PublicError("Request body is too large", 413), FALLBACK))
      .toEqual({ message: "Request body is too large", status: 413 });
    expect(publicError(new PublicError(VERIFICATION_FAILED, 403), FALLBACK))
      .toEqual({ message: VERIFICATION_FAILED, status: 403 });
  });

  it.each([
    new Error("Rate limiting is not configured"),
    new Error("Turnstile is not configured"),
    new Error("Invalid rate limit"), // a RAISE from a helper RPC, thrown as a plain Error
    new TypeError("fetch failed"),
    "a string",
    null,
    undefined,
    { message: "an object that only looks like an error" },
  ])("collapses %p to the fallback with a 500", (error) => {
    expect(publicError(error, FALLBACK)).toEqual({ message: FALLBACK, status: 500 });
  });
});

describe("the client error contract", () => {
  // src/services/bookings.ts classifies the Edge response by these strings; the
  // frontend tests in bookings.test.ts pin its side, this pins ours.
  it("keeps the strings the frontend classifies on", () => {
    expect(VERIFICATION_FAILED).toMatch(/verification/i);
    expect(SLOT_TAKEN).toMatch(/no longer available/i);
  });
});
