import { createClient } from "npm:@supabase/supabase-js@2";
import { PublicError } from "../_shared/public-error.ts";
import { getClientIp, handleCors, hashSubject, json, rateLimitHit, readJsonBody } from "../_shared/security.ts";
import { isHealthRequest, runHealthCheck } from "../_shared/health.ts";

// Anonymous booking-funnel counter. Public (verify_jwt = false) but enum-only: the
// body names one step and nothing else is read or stored — no id, no IP, no
// timestamp finer than the hour (record_funnel_step). Not a form, so no Turnstile;
// the client only calls it after consent, at most once per step per page load.
// Not in the warm-up list: callers fire and forget, so a cold start costs nobody
// anything. The 15-minute health check (_shared/health.ts) is its only scheduled caller.

const MAX_JSON_BODY_BYTES = 256;
const FUNNEL_STEPS = new Set(["page_view", "form_open", "review", "verify", "submitted"]);
// A whole hall shares one NUS/NAT address and a full funnel is five events, so the
// budget is generous; it exists to stop one client flooding the table, not to meter
// real visits.
const MAX_EVENTS_PER_WINDOW = 300;

const HEALTH = {
  name: "log-funnel-step",
  required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_SALT"],
};

export const handler = async (req: Request): Promise<Response> => {
  if (isHealthRequest(req)) return runHealthCheck(HEALTH);

  const cors = handleCors(req);
  if (cors.response) return cors.response;
  const { origin } = cors;

  if (req.method !== "POST") {
    return json(origin, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("log-funnel-step missing Supabase environment");
    return json(origin, { error: "Could not record step." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
    } catch (error) {
      if (error instanceof PublicError && error.status === 413) {
        return json(origin, { error: "Request body is too large." }, 413);
      }
      return json(origin, { error: "Invalid request." }, 400);
    }

    const step = body?.step;
    if (typeof step !== "string" || !FUNNEL_STEPS.has(step)) {
      return json(origin, { error: "Invalid request." }, 400);
    }

    const ipHash = await hashSubject(getClientIp(req));
    const allowed = await rateLimitHit(supabase, "log-funnel-step", ipHash, MAX_EVENTS_PER_WINDOW);
    if (!allowed) {
      return json(origin, { error: "Too many requests." }, 429);
    }

    const { error } = await supabase.rpc("record_funnel_step", { _step: step });
    if (error) {
      console.error("record_funnel_step failed", error.code, error.message);
      return json(origin, { error: "Could not record step." }, 500);
    }

    return json(origin, { ok: true });
  } catch (error) {
    console.error("log-funnel-step error", error instanceof Error ? error.message : String(error));
    return json(origin, { error: "Could not record step." }, 500);
  }
};

// Exported so tests can call it; serving stays unconditional so the runtime never
// depends on how it marks the entry module.
Deno.serve(handler);
