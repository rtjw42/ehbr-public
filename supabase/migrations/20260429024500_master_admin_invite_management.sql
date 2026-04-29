-- Master-admin-only invite management and safer invite usage limits.

ALTER TABLE public.admin_invite_codes
ADD COLUMN IF NOT EXISTS max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.is_master_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role)
    AND lower(coalesce(auth.jwt() ->> 'email', '')) = 'rtjw42@gmail.com'
$$;

DROP POLICY IF EXISTS "Admins view invite codes" ON public.admin_invite_codes;
DROP POLICY IF EXISTS "Admins manage invite codes" ON public.admin_invite_codes;

CREATE POLICY "Master admin views invite codes"
ON public.admin_invite_codes
FOR SELECT
USING (public.is_master_admin());

CREATE POLICY "Master admin creates invite codes"
ON public.admin_invite_codes
FOR INSERT
WITH CHECK (public.is_master_admin());

CREATE POLICY "Master admin updates invite codes"
ON public.admin_invite_codes
FOR UPDATE
USING (public.is_master_admin())
WITH CHECK (public.is_master_admin());

CREATE POLICY "Master admin deletes invite codes"
ON public.admin_invite_codes
FOR DELETE
USING (public.is_master_admin());

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

  UPDATE public.admin_invite_codes
  SET used_count = used_count + 1,
      last_used_at = now()
  WHERE active = true
    AND code_hash = public.hash_admin_invite_code(invite_code)
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses
  RETURNING id INTO invite_id;

  IF invite_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (current_user_id, 'admin'::public.app_role)
  ON CONFLICT DO NOTHING;

  RETURN true;
END;
$$;
