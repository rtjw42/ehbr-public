-- Owner / Band Head / Band Leader roles. Replaces the hardcoded-email "master
-- admin" (private.is_master_admin, = email 'owner@example.com') with data-driven
-- capability flags, removing the email from the database entirely.
--
--   • Band Leader / Exco = the existing `admin` role (operational: bookings, events).
--     Unchanged — no operational RLS touched.
--   • Band Head        = admin + is_head → may manage invite codes.
--   • Owner            = admin + is_owner → may manage roles (promote heads,
--                        deactivate staff) + everything below. Top tier.
--
-- Capability flags live in a NEW locked-down table (NOT on admin_profiles, which is
-- public-read for display names) so the org structure isn't exposed to anon. An
-- admin may read only their OWN row; all writes go through SECURITY DEFINER
-- functions. Owner is bootstrapped out-of-band (not in this migration → no identity
-- in source); until then no one can manage invites, so apply + bootstrap together.

-- ── 1) Capability table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_capabilities (
  user_id uuid PRIMARY KEY REFERENCES public.admin_profiles(user_id) ON DELETE CASCADE,
  is_head boolean NOT NULL DEFAULT false,
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_capabilities ENABLE ROW LEVEL SECURITY;

-- An admin may read ONLY their own capability row (to know which UI to show).
-- No write policies — writes go through the SECURITY DEFINER functions/trigger only,
-- and reading OTHERS' rows is owner-only via list_staff().
DROP POLICY IF EXISTS "Admins read own capabilities" ON public.admin_capabilities;
CREATE POLICY "Admins read own capabilities"
ON public.admin_capabilities
FOR SELECT
USING (auth.uid() = user_id);

-- Backfill a row for every existing admin (all flags default false).
INSERT INTO public.admin_capabilities (user_id)
SELECT user_id FROM public.admin_profiles
ON CONFLICT (user_id) DO NOTHING;

-- ── 2) Auto-provision a capability row alongside the admin profile ───────────
CREATE OR REPLACE FUNCTION public.ensure_admin_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin'::public.app_role THEN
    INSERT INTO public.admin_profiles (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.admin_capabilities (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3) Capability helpers (replace the hardcoded-email master check) ─────────
CREATE OR REPLACE FUNCTION private.can_manage_invites()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.admin_capabilities c
      WHERE c.user_id = auth.uid() AND (c.is_head OR c.is_owner)
    )
$$;

CREATE OR REPLACE FUNCTION private.is_org_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.admin_capabilities c
      WHERE c.user_id = auth.uid() AND c.is_owner
    )
$$;

GRANT EXECUTE ON FUNCTION private.can_manage_invites() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_org_owner() TO authenticated, service_role;

-- ── 4) Repoint invite-code policies: is_master_admin → can_manage_invites ────
DROP POLICY IF EXISTS "Master admin views invite codes" ON public.admin_invite_codes;
CREATE POLICY "Invite managers view invite codes"
ON public.admin_invite_codes FOR SELECT USING (private.can_manage_invites());

DROP POLICY IF EXISTS "Master admin creates invite codes" ON public.admin_invite_codes;
CREATE POLICY "Invite managers create invite codes"
ON public.admin_invite_codes FOR INSERT WITH CHECK (private.can_manage_invites());

DROP POLICY IF EXISTS "Master admin updates invite codes" ON public.admin_invite_codes;
CREATE POLICY "Invite managers update invite codes"
ON public.admin_invite_codes FOR UPDATE USING (private.can_manage_invites()) WITH CHECK (private.can_manage_invites());

DROP POLICY IF EXISTS "Master admin deletes invite codes" ON public.admin_invite_codes;
CREATE POLICY "Invite managers delete invite codes"
ON public.admin_invite_codes FOR DELETE USING (private.can_manage_invites());

-- The hardcoded-email master check is now unused — drop it (removes the email).
DROP FUNCTION IF EXISTS private.is_master_admin();

-- ── 5) Owner-only management RPCs (SECURITY DEFINER, guarded by is_org_owner) ─
-- Read all staff (owner-only). The Organisation tab reads via this, never the table.
CREATE OR REPLACE FUNCTION public.list_staff()
RETURNS TABLE(user_id uuid, display_name text, is_head boolean, is_owner boolean)
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
  SELECT p.user_id, p.display_name,
         coalesce(c.is_head, false), coalesce(c.is_owner, false)
  FROM public.admin_profiles p
  JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'admin'::public.app_role
  LEFT JOIN public.admin_capabilities c ON c.user_id = p.user_id
  ORDER BY p.display_name
  LIMIT 200;
END;
$$;

-- Promote/demote a Band Head.
CREATE OR REPLACE FUNCTION public.set_band_head(_target_user_id uuid, _make_head boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_org_owner() THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF NOT private.has_role(_target_user_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Target is not an admin';
  END IF;
  INSERT INTO public.admin_capabilities (user_id, is_head)
  VALUES (_target_user_id, _make_head)
  ON CONFLICT (user_id) DO UPDATE SET is_head = excluded.is_head;
END;
$$;

-- Offboard staff: revoke the admin role (+ clear capabilities). Never deletes the
-- auth user. Can't deactivate yourself or an owner (so the last owner is safe).
CREATE OR REPLACE FUNCTION public.deactivate_staff(_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_org_owner() THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF _target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot deactivate yourself';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_capabilities c WHERE c.user_id = _target_user_id AND c.is_owner) THEN
    RAISE EXCEPTION 'You cannot deactivate an owner';
  END IF;
  DELETE FROM public.admin_capabilities WHERE user_id = _target_user_id;
  DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = 'admin'::public.app_role;
END;
$$;

REVOKE ALL ON FUNCTION public.list_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_band_head(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_band_head(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_staff(uuid) TO authenticated;
