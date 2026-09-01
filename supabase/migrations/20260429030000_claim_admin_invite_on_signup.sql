-- Claim invite codes server-side when a new Supabase Auth user is created.
-- The raw invite code is consumed from auth.users.raw_user_meta_data and removed.

CREATE OR REPLACE FUNCTION public.handle_admin_invite_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_code TEXT := NEW.raw_user_meta_data ->> 'invite_code';
  invite_id UUID;
BEGIN
  IF invite_code IS NULL OR length(trim(invite_code)) = 0 THEN
    RETURN NEW;
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
  VALUES (NEW.id, 'admin'::public.app_role)
  ON CONFLICT DO NOTHING;

  UPDATE auth.users
  SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invite_code'
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_registered_with_invite ON auth.users;

CREATE TRIGGER on_auth_user_registered_with_invite
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_admin_invite_signup();
