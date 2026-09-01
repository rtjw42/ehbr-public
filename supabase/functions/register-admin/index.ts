// ── register-admin (PUBLIC edge function) ────────────────────────────────────
// Trust boundary: verify_jwt = false (see supabase/config.toml) — reachable by
// anon. Compensating guards: CORS allow-list, Cloudflare Turnstile, and per-IP
// rate limiting before any DB write. Registration requires a valid hashed invite
// code, so an unauthenticated caller cannot self-grant admin. Errors stay generic
// so the endpoint does not enumerate existing accounts.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getClientIp,
  handleCors,
  hashSubject,
  isWarmupRequest,
  json,
  rateLimitBlocked,
  rateLimitHit,
  readJsonBody,
  stripHtmlText,
  verifyTurnstile,
  warmupResponse,
} from "../_shared/security.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_JSON_BODY_BYTES = 16 * 1024;

Deno.serve(async (req) => {
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
    console.error("register-admin missing Supabase environment");
    return json(origin, { error: "Could not create account." }, 500);
  }

  const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const anonSupabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Origin: origin } },
  });

  try {
    const ip = getClientIp(req);
    const ipHash = await hashSubject(ip);
    const locked = await rateLimitBlocked(serviceSupabase, "admin-invite-failed", ipHash, 5);
    if (locked) {
      return json(origin, { error: "Too many failed invite attempts. Please try again later." }, 429);
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
    } catch (error) {
      if (error instanceof Error && /too large/i.test(error.message)) {
        return json(origin, { error: "Request body is too large." }, 413);
      }
      return json(origin, { error: "Invalid registration request." }, 400);
    }

    const email = stripHtmlText(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const inviteCode = stripHtmlText(body.inviteCode);
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    const action = typeof body.action === "string" ? body.action : "register";
    const requestedRedirect = typeof body.emailRedirectTo === "string" ? body.emailRedirectTo : "";
    const emailRedirectTo = requestedRedirect.startsWith(origin)
      ? requestedRedirect
      : `${origin}/registration-success`;

    if (!inviteCode) {
      await rateLimitHit(serviceSupabase, "admin-invite-failed", ipHash, 5);
      return json(origin, { error: "Invalid or expired invite code." }, 400);
    }

    const { data: validInvite, error: inviteError } = await serviceSupabase.rpc("security_is_valid_admin_invite", {
      _invite_code: inviteCode,
    });
    if (inviteError) throw inviteError;
    if (validInvite !== true) {
      await rateLimitHit(serviceSupabase, "admin-invite-failed", ipHash, 5);
      return json(origin, { error: "Invalid or expired invite code." }, 400);
    }

    if (action === "validate-invite") {
      return json(origin, { ok: true });
    }

    if (!emailPattern.test(email)) {
      return json(origin, { error: "Enter a valid email address." }, 400);
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return json(origin, { error: "Password must be at least 8 characters and include a letter and number." }, 400);
    }
    if (!turnstileToken) {
      return json(origin, { error: "Please complete the verification challenge." }, 400);
    }

    await verifyTurnstile(turnstileToken, ip);

    const { data, error } = await anonSupabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: { invite_code: inviteCode },
      },
    });
    if (error) {
      const message = /invite|database|trigger|hook/i.test(error.message)
        ? "Invalid or expired invite code."
        : "Could not create account.";
      if (message.includes("invite")) await rateLimitHit(serviceSupabase, "admin-invite-failed", ipHash, 5);
      return json(origin, { error: message }, 400);
    }

    const duplicate = data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
    if (duplicate) {
      return json(origin, { ok: true, needsEmailConfirmation: true });
    }

    return json(origin, { ok: true, needsEmailConfirmation: !data.session });
  } catch (error) {
    console.error("register-admin error", error);
    return json(origin, { error: "Could not create account." }, 500);
  }
});
