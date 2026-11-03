-- Invite-code based admin registration for band leaders.
-- No plaintext invite codes are stored in the database.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.admin_invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view invite codes"
ON public.admin_invite_codes
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins manage invite codes"
ON public.admin_invite_codes
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.hash_admin_invite_code(_invite_code TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(extensions.digest(trim(_invite_code), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.claim_admin_invite(invite_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_id UUID;
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to claim an invite code';
  END IF;

  SELECT id INTO invite_id
  FROM public.admin_invite_codes
  WHERE active = true
    AND code_hash = public.hash_admin_invite_code(invite_code)
  LIMIT 1;

  IF invite_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, 'admin'::public.app_role)
  ON CONFLICT DO NOTHING;

  UPDATE public.admin_invite_codes
  SET used_count = used_count + 1,
      last_used_at = now()
  WHERE id = invite_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_admin_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_admin_invite(TEXT) TO authenticated;

-- Admin access should now be granted through invite codes, not a hardcoded email.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
