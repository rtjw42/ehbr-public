// Which error messages may reach a caller verbatim. Trust is by ORIGIN, never
// by what the text happens to contain: exactly two sources are ours to show —
// a PublicError a handler threw on purpose, and a `RAISE EXCEPTION` raised by
// one of our own RPCs. Everything else (a Postgres internal such as a failed
// cast or a null violation, a network failure, a missing secret) collapses to
// the handler's fallback with a 500. The keyword allow-list this replaced let
// `invalid input syntax for type uuid` through to an anonymous caller as a 400.
//
// Pure — no Deno APIs — so Vitest imports it directly (src/lib/public-error.test.ts).

export class PublicError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicError";
    this.status = status;
  }
}

// Part of the client error contract: src/services/bookings.ts classifies the
// response on these strings. Change them there in the same commit.
export const VERIFICATION_FAILED = "Verification failed or expired. Please complete the challenge again.";
export const SLOT_TAKEN = "That time is no longer available.";

// A keyword match is fine HERE because the vocabulary is ours — every message
// comes from a RAISE in supabase/migrations, not from Postgres.
const statusForRaised = (message: string) => {
  if (/too many/i.test(message)) return 429;
  if (/overlap/i.test(message)) return 409;
  return 400;
};

// Wraps the error object supabase-js returns from `.rpc()`. `code` is the
// SQLSTATE: PL/pgSQL `RAISE EXCEPTION` reports P0001 and an exclusion-constraint
// violation 23P01. Any other code is Postgres talking and stays a plain Error,
// which `publicError` below turns into the fallback — the code is kept in the
// message so the function logs still say what actually happened.
export const rpcError = (error: { code?: string | null; message?: string | null }) => {
  if (error.code === "23P01") return new PublicError(SLOT_TAKEN, 409);
  if (error.code === "P0001" && error.message) return new PublicError(error.message, statusForRaised(error.message));
  return new Error(`${error.code ?? "unknown"}: ${error.message ?? "RPC failed"}`);
};

// What a handler's catch-all sends back.
export const publicError = (error: unknown, fallback: string) =>
  error instanceof PublicError
    ? { message: error.message, status: error.status }
    : { message: fallback, status: 500 };
