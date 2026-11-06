// ── Deep health check ─────────────────────────────────────────────────────────
// Answers the 15-minute health cron (`private.health_check_edge_functions`): a
// request carrying the warm-up secret plus `x-health: deep`. The function confirms
// the secrets it cannot work without are set, and that the database answers one
// read-only RPC, then reports to Healthchecks.io. That service alerts the owner on
// a `/fail` ping at once, and on a missed ping after its grace period, so a paused
// project, a broken cron or a crashed function alert as surely as a missing secret.
//
// Why this exists: the warm-up ping returns 200 before checking anything, so a
// missing RATE_LIMIT_SALT (every booking 500s) or missing Telegram config (requests
// accepted but never seen by admins) used to fail silently.
//
// The response and the failure ping name what is missing, never a value. With no
// HEALTHCHECKS_PING_KEY the check still runs and answers but reports nowhere, so a
// fork without monitoring stays quiet, and monitoring-only requirements (Telegram)
// do not apply to it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isWarmupRequest, rateLimitBlocked } from "./security.ts";

type HealthSpec = {
  /** The function's name; also its Healthchecks.io check (slug). */
  name: string;
  /** Environment variables the function cannot work without. */
  required: string[];
  /** Required only on a deployment that reports health (it has HEALTHCHECKS_PING_KEY). */
  requiredWhenMonitored?: string[];
};

const PING_TIMEOUT_MS = 5000;

export const isHealthRequest = (req: Request) =>
  isWarmupRequest(req) && req.headers.get("x-health") === "deep";

const env = (key: string) => Deno.env.get(key) ?? "";

// Best effort: a monitoring outage must never fail the check itself.
const ping = async (url: string, body: string) => {
  try {
    await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
  } catch (error) {
    console.warn("[health] ping failed", error instanceof Error ? error.message : String(error));
  }
};

// Reports one result to the named check. create=1 makes Healthchecks.io create the
// check on its first ping. Does nothing on a deployment without a ping key.
export const reportHealth = async (name: string, ok: boolean, body: string) => {
  const pingKey = env("HEALTHCHECKS_PING_KEY");
  if (pingKey) await ping(`https://hc-ping.com/${pingKey}/${name}${ok ? "" : "/fail"}?create=1`, body);
};

export const runHealthCheck = async ({ name, required, requiredWhenMonitored = [] }: HealthSpec) => {
  const monitored = Boolean(env("HEALTHCHECKS_PING_KEY"));
  const problems = [...required, ...(monitored ? requiredWhenMonitored : [])]
    .filter((key) => !env(key))
    .map((key) => `${key} missing`);
  if (!env("ALLOWED_ORIGINS") && !env("SITE_URL")) {
    problems.push("ALLOWED_ORIGINS and SITE_URL both missing");
  }

  if (env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY")) {
    try {
      const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
      // Read-only (it counts, never inserts), and on the path every public function
      // uses: the service-role key, the private schema and the RPC grants.
      await rateLimitBlocked(supabase, "health", "health", 1);
    } catch (error) {
      console.error("[health] database check failed", error instanceof Error ? error.message : String(error));
      problems.push("database check failed");
    }
  }

  const ok = problems.length === 0;
  await reportHealth(name, ok, problems.join("\n"));
  return new Response(JSON.stringify({ ok, problems }), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
};
