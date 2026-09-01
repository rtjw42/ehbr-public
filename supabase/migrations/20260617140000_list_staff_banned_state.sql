-- Stage 3 — "Deactivate = ban". Deactivation is now a real auth-layer ban
-- (auth.users.banned_until, set by the owner-only `set-staff-ban` Edge Function)
-- instead of a role strip. The admin role is intentionally KEPT while banned so the
-- person stays listed and reactivation is just an unban. Two DB changes:
--   1) Surface the banned state in list_staff() so the Organisation tab can show a
--      "Deactivated" badge + a Reactivate action.
--   2) Drop the old deactivate_staff() RPC — its role-strip semantics are replaced
--      by the Edge Function ban, so this privileged surface is now dead code.

-- ── 1) list_staff(): add is_banned ───────────────────────────────────────────
-- Return-type change → DROP + CREATE (CREATE OR REPLACE can't alter the signature).
-- Still owner-only (re-checks is_org_owner), so email + ban state never leak past
-- the owner. banned_until is a future timestamp while banned, NULL/past otherwise.
DROP FUNCTION IF EXISTS public.list_staff();

CREATE FUNCTION public.list_staff()
RETURNS TABLE(
  user_id uuid,
  display_name text,
  email text,
  is_head boolean,
  is_owner boolean,
  is_banned boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_org_owner() THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  RETURN QUERY
  SELECT p.user_id, p.display_name, coalesce(u.email, '')::text,
         coalesce(c.is_head, false), coalesce(c.is_owner, false),
         coalesce(u.banned_until > now(), false)
  FROM public.admin_profiles p
  JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'admin'::public.app_role
  JOIN auth.users u ON u.id = p.user_id
  LEFT JOIN public.admin_capabilities c ON c.user_id = p.user_id
  ORDER BY p.display_name
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.list_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;

-- ── 2) Drop the superseded role-strip RPC ────────────────────────────────────
-- Deactivation now goes through the set-staff-ban Edge Function (auth-layer ban),
-- which re-verifies the owner server-side. The old RPC stripped the admin role,
-- which would also drop the person from list_staff() — incompatible with keeping
-- them listed as "Deactivated". Remove it so no stale privileged path lingers.
DROP FUNCTION IF EXISTS public.deactivate_staff(uuid);
