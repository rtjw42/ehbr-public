-- Booking groups were being orphaned: deleting a series / following-occurrences
-- (or the last remaining occurrence) removes the bookings but never the now-empty
-- booking_groups row. This (1) cleans up the existing orphans and (2) adds a
-- trigger that removes a group automatically once its last booking is deleted,
-- so it can't recur from any delete path (current or future).

-- 1) One-time cleanup of existing orphaned groups.
DELETE FROM public.booking_groups g
WHERE NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.group_id = g.id);

-- 2) Auto-remove a group when its last booking is deleted.
--    SECURITY DEFINER so the cleanup runs regardless of who deleted the booking;
--    it only ever deletes a group that has no remaining bookings.
CREATE OR REPLACE FUNCTION public.delete_empty_booking_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.group_id IS NOT NULL THEN
    DELETE FROM public.booking_groups g
    WHERE g.id = OLD.group_id
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.group_id = OLD.group_id);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_empty_booking_group ON public.bookings;
CREATE TRIGGER trg_delete_empty_booking_group
AFTER DELETE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.delete_empty_booking_group();
