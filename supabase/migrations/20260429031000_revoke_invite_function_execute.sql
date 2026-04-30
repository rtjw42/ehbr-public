-- Tighten execute permissions on invite-related functions.

REVOKE EXECUTE ON FUNCTION public.claim_admin_invite(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_admin_invite_signup() FROM anon, authenticated;
