// Deployment config, not source: each deployment sets its own origins so no
// domain is hardcoded here. `ALLOWED_ORIGINS` is a comma-separated list; it falls
// back to `SITE_URL` (already required for absolute links) so a deployment that
// sets only that one still works. Local dev origins belong in the local
// functions env, never in the production secret.
//
// Read once at module load: Edge Function instances are short-lived, and a
// changed secret takes effect on the next deploy either way.
const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("SITE_URL") ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set(configuredOrigins);

if (ALLOWED_ORIGINS.size === 0) {
  // Fails closed: every request is rejected until the secret is set. Loud,
  // because the symptom (all public forms 403) is otherwise hard to trace.
  console.error("ALLOWED_ORIGINS and SITE_URL are both unset — every origin will be rejected.");
}

export type TurnstileResponse = {
  success: boolean;
  "error-codes"?: string[];
};

export const getOrigin = (req: Request) => req.headers.get("Origin") ?? "";

export const isAllowedOrigin = (origin: string) => ALLOWED_ORIGINS.has(origin);

export const corsHeadersFor = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

export const forbiddenCors = () => new Response(
  JSON.stringify({ error: "Origin not allowed." }),
  {
    status: 403,
    headers: { "Content-Type": "application/json", "Vary": "Origin" },
  },
);

export const handleCors = (req: Request) => {
  const origin = getOrigin(req);
  if (!isAllowedOrigin(origin)) return { origin, response: forbiddenCors() };
  if (req.method === "OPTIONS") {
    return { origin, response: new Response(null, { headers: corsHeadersFor(origin) }) };
  }
  return { origin, response: null };
};

export const json = (origin: string, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
  });

export const assertRequestSize = (req: Request, maxBytes: number, requireLength = false) => {
  const rawLength = req.headers.get("Content-Length");
  if (!rawLength) {
    if (requireLength) throw new Error("Request size is required");
    return;
  }
  const byteLength = Number(rawLength);
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error("Invalid request size");
  }
  if (byteLength > maxBytes) {
    throw new Error("Request body is too large");
  }
};

export const readJsonBody = async (req: Request, maxBytes: number) => {
  // Require Content-Length so an oversized body is rejected before it is buffered,
  // not just after. Browsers set this automatically for string fetch bodies.
  assertRequestSize(req, maxBytes, true);
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    throw new Error("Request body is too large");
  }
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON body");
  }
};

// The subject every rate limit is keyed on, so its trustworthiness IS the rate limit.
// CF-Connecting-IP is set by Cloudflare (which fronts Supabase Edge Functions) and cannot
// be forged by the client — it is the only source here we can actually trust. The
// X-Forwarded-For fallback is NOT safe on its own: Cloudflare *appends* to XFF, so its
// leftmost entry is whatever the client sent. If CF-Connecting-IP ever goes missing we
// would silently key on a spoofable value and the limiter would fail open — so say so
// loudly rather than let that rot unnoticed.
export const getClientIp = (req: Request) => {
  const cfIp = req.headers.get("CF-Connecting-IP");
  if (!cfIp) {
    console.warn("[security] CF-Connecting-IP absent — rate limiting is falling back to a client-spoofable IP header");
  }
  const forwarded = req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return cfIp ?? forwarded ?? req.headers.get("X-Real-IP") ?? "unknown";
};

export const hashSubject = async (subject: string) => {
  const salt = Deno.env.get("RATE_LIMIT_SALT");
  if (!salt) throw new Error("Rate limiting is not configured");
  const bytes = new TextEncoder().encode(`${salt}:${subject}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const stripHtmlText = (value: unknown) => (
  typeof value === "string" ? value.replace(/<[^>]*>/g, "").trim() : ""
);

export const rateLimitHit = async (
  supabase: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> },
  scope: string,
  subjectHash: string,
  maxAttempts: number,
  windowText = "10 minutes",
) => {
  const { data, error } = await supabase.rpc("security_rate_limit_hit", {
    _scope: scope,
    _subject_hash: subjectHash,
    _max_attempts: maxAttempts,
    _window: windowText,
  });
  if (error) throw new Error(error.message || "Rate limit check failed");
  return data === true;
};

export const rateLimitBlocked = async (
  supabase: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> },
  scope: string,
  subjectHash: string,
  maxAttempts: number,
  windowText = "10 minutes",
) => {
  const { data, error } = await supabase.rpc("security_rate_limit_blocked", {
    _scope: scope,
    _subject_hash: subjectHash,
    _max_attempts: maxAttempts,
    _window: windowText,
  });
  if (error) throw new Error(error.message || "Rate limit check failed");
  return data === true;
};

// `context` is folded into the failure logs (e.g. { scope, ipHash }) so a genuine
// Turnstile problem is diagnosable in one query — correlate by the platform's
// per-invocation execution_id. Optional, so other callers stay untouched.
export const verifyTurnstile = async (
  token: string,
  remoteIp: string,
  context: Record<string, unknown> = {},
) => {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) throw new Error("Turnstile is not configured");

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (remoteIp && remoteIp !== "unknown") formData.append("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    // Cloudflare-side/network failure — log so a real outage is distinguishable from a
    // bad token, not silently collapsed into the same generic error.
    console.warn("[turnstile] siteverify request failed", JSON.stringify({ status: response.status, ...context }));
    throw new Error("Could not verify anti-bot challenge");
  }
  const result = (await response.json()) as TurnstileResponse;
  if (!result.success) {
    // error-codes separate duplicate/expired from invalid/forged; ipHash shows whether
    // failures cluster on one device.
    console.warn("[turnstile] verification failed", JSON.stringify({ errorCodes: result["error-codes"] ?? [], ...context }));
    throw new Error("Verification failed or expired. Please complete the challenge again.");
  }
};

export const cleanErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  if (/verification|turnstile|challenge/i.test(message)) return "Verification failed or expired. Please complete the challenge again.";
  if (/required|invalid|must|array|between|after|100 characters|366 sessions|too large|request size|json body/i.test(message)) return message;
  if (/conflict|overlap|exclude constraint/i.test(message)) return "That time is no longer available.";
  return fallback;
};

export const statusForMessage = (message: string) => {
  if (/too many|rate limit|try again later/i.test(message)) return 429;
  if (/verification|turnstile|challenge/i.test(message)) return 403;
  if (/conflict|overlap|available/i.test(message)) return 409;
  if (/too large/i.test(message)) return 413;
  if (/required|invalid|must|array|between|after|100 characters|366 sessions|request size|json body/i.test(message)) return 400;
  return 500;
};

// ── Warmup ping ──────────────────────────────────────────────────────────────
// A pg_cron + pg_net job pings each public function on a schedule to keep its
// isolate hot, so real (interactive) requests don't pay an Edge Function cold
// start. isWarmupRequest is checked at the very TOP of each handler — before CORS
// (the scheduler sends no browser Origin) and before any DB / Turnstile /
// rate-limit work — and warmupResponse returns immediately. Gated by a shared
// WARMUP_SECRET so the unauthenticated short-circuit can't be abused to burn the
// invocation quota; if the secret is unset the ping simply falls through to normal
// handling (which still boots the isolate, just less cleanly).
export const isWarmupRequest = (req: Request) => {
  const secret = Deno.env.get("WARMUP_SECRET");
  if (!secret) return false;
  return req.headers.get("x-warmup-secret") === secret;
};

export const warmupResponse = () =>
  new Response(JSON.stringify({ ok: true, warm: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
