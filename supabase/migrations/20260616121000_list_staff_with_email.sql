-- Add the account email to list_staff() so the owner can identify staff in the
-- Organisation tab before they've set a display name. Still owner-only (the RPC
-- re-checks is_org_owner), so emails are never exposed beyond the owner.
-- Return-type change → DROP + CREATE (CREATE OR REPLACE can't alter the signature).

DROP FUNCTION IF EXISTS public.list_staff();

CREATE FUNCTION public.list_staff()
RETURNS TABLE(user_id uuid, display_name text, email text, is_head boolean, is_owner boolean)
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
         coalesce(c.is_head, false), coalesce(c.is_owner, false)
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
