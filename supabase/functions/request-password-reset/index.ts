// ── request-password-reset (PUBLIC edge function) ────────────────────────────
// Trust boundary: verify_jwt = false (see supabase/config.toml) — reachable by
// anon. Compensating guards: CORS allow-list, Cloudflare Turnstile, and per-IP
// rate limiting. The response is identical whether or not the email exists, so
// the endpoint never reveals which addresses are registered. The rate-limit
// ledger is written with the service role; the reset email itself goes through
// Supabase Auth on the anon client, so no admin state is exposed to the caller.
import { createClient } from "npm:@supabase/supabase-js@2";
import { PublicError, publicError } from "../_shared/public-error.ts";
import {
  getClientIp,
  handleCors,
  hashSubject,
  isWarmupRequest,
  json,
  rateLimitHit,
  readJsonBody,
  stripHtmlText,
  verifyTurnstile,
  warmupResponse,
} from "../_shared/security.ts";
import { isHealthRequest, runHealthCheck } from "../_shared/health.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_JSON_BODY_BYTES = 16 * 1024;

const HEALTH = {
  name: "request-password-reset",
  required: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_SALT", "TURNSTILE_SECRET_KEY"],
};

export const handler = async (req: Request): Promise<Response> => {
  if (isHealthRequest(req)) return runHealthCheck(HEALTH);
  if (isWarmupRequest(req)) return warmupResponse();

  const cors = handleCors(req);
  if (cors.response) return cors.response;
  const { origin } = cors;

  if (req.method !== "POST") {
    return json(origin, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("request-password-reset missing Supabase environment");
    return json(origin, { error: "Could not send password reset email." }, 500);
  }

  try {
    const ip = getClientIp(req);
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
    } catch (error) {
      if (error instanceof PublicError && error.status === 413) {
        return json(origin, { error: "Request body is too large." }, 413);
      }
      return json(origin, { error: "Invalid password reset request." }, 400);
    }

    const email = stripHtmlText(body.email);
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    const requestedRedirect = typeof body.redirectTo === "string" ? body.redirectTo : "";
    const redirectTo = requestedRedirect === origin || requestedRedirect.startsWith(`${origin}/`)
      ? requestedRedirect
      : `${origin}/reset-password`;

    if (!emailPattern.test(email)) {
      return json(origin, { error: "Enter a valid email address." }, 400);
    }
    if (!turnstileToken) {
      return json(origin, { error: "Please complete the verification challenge." }, 400);
    }

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const ipHash = await hashSubject(ip);
    const limited = await rateLimitHit(serviceSupabase, "password-reset", ipHash, 5);
    if (!limited) {
      return json(origin, { error: "Too many password reset attempts. Please try again later." }, 429);
    }

    await verifyTurnstile(turnstileToken, ip);

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Origin: origin } },
    });
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      console.error("resetPasswordForEmail failed", error.message);
      return json(origin, { error: "Could not send password reset email." }, 500);
    }

    return json(origin, { ok: true });
  } catch (error) {
    console.error("request-password-reset error", error);
    // Only deliberate PublicErrors pass through: in practice a failed Turnstile check,
    // which tells the person to redo the challenge and reveals nothing about the email.
    const { message, status } = publicError(error, "Could not send password reset email.");
    return json(origin, { error: message }, status);
  }
};

// Exported so tests can call it; serving stays unconditional so the runtime never
// depends on how it marks the entry module.
Deno.serve(handler);
