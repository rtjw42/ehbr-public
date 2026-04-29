-- Invite codes should only be consumed by the auth.users signup trigger.

REVOKE EXECUTE ON FUNCTION public.claim_admin_invite(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_admin_invite_signup() FROM authenticated;
