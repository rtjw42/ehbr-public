-- Phase B: atomic, no-overwrite group approval.
--
-- The approval model settled in the 2026-07-05 grill: a request (single or group)
-- is the unit of approval, groups approve atomically, and NOTHING an Approve does
-- ever bumps an already-approved booking — first-come wins; the later request is
-- blocked in the UI until the admin deliberately frees the slot.
--
--   • approve_booking_group(_group_id): plain atomic approve of every instance in
--     the group, stamping approved_by. No overlap handling on purpose — if any
--     instance clashes with an approved booking, the no_approved_overlap EXCLUDE
--     constraint aborts the whole transaction (all-or-nothing), and the client
--     surfaces "That time is no longer available." (normalizeBookingError already
--     matches the constraint name). The UI disables Approve on a visible clash;
--     the constraint is the concurrency backstop.
--
--   • approve_booking_overwrite / approve_booking_group_overwrite are DROPPED:
--     the overwrite path is retired everywhere (frontend no longer calls them,
--     and dead SECURITY-path functions are surface we don't keep).
--
-- SECURITY INVOKER (like approve_booking): the role check raises for non-admins,
-- and the "Admins update bookings" RLS policy enforces it at the row level too.

CREATE OR REPLACE FUNCTION public.approve_booking_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  UPDATE public.bookings
  SET status = 'approved', approved_by = auth.uid()
  WHERE group_id = _group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking group not found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_booking_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_booking_group(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.approve_booking_overwrite(uuid);
DROP FUNCTION IF EXISTS public.approve_booking_group_overwrite(uuid);
