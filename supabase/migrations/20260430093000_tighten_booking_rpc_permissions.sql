CREATE SCHEMA IF NOT EXISTS extensions;

ALTER EXTENSION btree_gist SET SCHEMA extensions;

REVOKE EXECUTE ON FUNCTION public.approve_booking(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_booking(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.reject_booking(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_booking(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.approve_booking_overwrite(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_booking_overwrite(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.approve_booking_group_overwrite(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_booking_group_overwrite(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.approve_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_booking_overwrite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_booking_group_overwrite(uuid) TO authenticated;
