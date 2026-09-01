-- Remove default PUBLIC execute grants from invite-related functions.

REVOKE EXECUTE ON FUNCTION public.handle_admin_invite_signup() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_admin_invite(TEXT) FROM PUBLIC;
