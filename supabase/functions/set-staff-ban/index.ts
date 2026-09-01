// Owner-only "Deactivate = ban" action. Bans (or unbans) a staff member at the
// auth layer via the Supabase admin API — a real login block, replacing the old
// role-strip flow. Like upload-admin-file, this is NOT a public function: it is
// omitted from supabase/config.toml, so it keeps the platform default
// verify_jwt = true, and it additionally re-verifies the caller server-side
// (admin role + is_owner) before doing any work — never trusting frontend state.
//
// Ban semantics: ban_duration sets auth.users.banned_until far in the future,
// which immediately blocks new sign-ins AND blocks token refresh for the target.
// A currently-live access token still works until it expires (≤1h, its TTL); we
// deliberately keep the admin role so the person stays listed and reactivation is
// just an unban. There is no admin-API call to revoke another user's live session
// by id, so the ≤1h token TTL is the residual window (documented in OPERATIONS.md).
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanErrorMessage, handleCors, json, readJsonBody } from "../_shared/security.ts";

const MAX_JSON_BODY_BYTES = 4 * 1024;
// ~100 years — GoTrue has no "infinite", so a far-future duration is effectively
// indefinite. Reactivation passes "none", which clears banned_until.
const INDEFINITE_BAN = "876000h";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
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
    console.error("set-staff-ban missing Supabase environment");
    return json(origin, { error: "Could not update this person." }, 500);
  }

  try {
    // 1) Authenticate the caller from their bearer token.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(origin, { error: "Your admin session expired. Please sign in again." }, 401);
    }
    const authSupabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authSupabase.auth.getUser();
    if (userError || !user) {
      return json(origin, { error: "Your admin session expired. Please sign in again." }, 401);
    }

    // 2) Re-verify the caller is an Owner, server-side (service role bypasses RLS,
    //    so we replicate is_org_owner = admin role AND is_owner here).
    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const callerIsAdmin = await hasAdminRole(serviceSupabase, user.id);
    if (!callerIsAdmin) {
      return json(origin, { error: "Admin access is required." }, 403);
    }
    const callerIsOwner = await isOwner(serviceSupabase, user.id);
    if (!callerIsOwner) {
      return json(origin, { error: "Owner access required." }, 403);
    }

    // 3) Parse + validate the request.
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
    } catch {
      return json(origin, { error: "Invalid request." }, 400);
    }
    const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : "";
    const ban = body.ban === true;
    if (!uuidPattern.test(targetUserId)) {
      return json(origin, { error: "Invalid request." }, 400);
    }

    // The target must be a current admin in either direction (a banned staffer
    // keeps the admin role, so unban targets are admins too).
    if (!(await hasAdminRole(serviceSupabase, targetUserId))) {
      return json(origin, { error: "Target is not an admin." }, 400);
    }
    if (ban) {
      if (targetUserId === user.id) {
        return json(origin, { error: "You cannot deactivate yourself." }, 400);
      }
      if (await isOwner(serviceSupabase, targetUserId)) {
        return json(origin, { error: "You cannot deactivate an owner." }, 400);
      }
    }

    // 4) Apply the ban / unban via the admin API.
    const { error: updateError } = await serviceSupabase.auth.admin.updateUserById(targetUserId, {
      ban_duration: ban ? INDEFINITE_BAN : "none",
    });
    if (updateError) throw updateError;

    return json(origin, { ok: true });
  } catch (error) {
    console.error("set-staff-ban error", error);
    return json(origin, { error: cleanErrorMessage(error, "Could not update this person.") }, 500);
  }
});

// ── Server-side capability checks (service role; never trust frontend state) ───
const hasAdminRole = async (
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> => {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
};

const isOwner = async (
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> => {
  const { data, error } = await client
    .from("admin_capabilities")
    .select("is_owner")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.is_owner === true;
};
