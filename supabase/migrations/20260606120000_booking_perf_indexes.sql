-- Booking performance indexes.
--
-- 1) Series operations (delete-series / delete-following / group lookups) filter
--    bookings by group_id, which had no index — sequential scans that worsen as
--    the table grows.
-- 2) The hot public read ("approved bookings in a window") filters on status AND
--    ranges on start_time; a composite (status, start_time) serves it in one scan.
--
-- The standalone status index is then redundant (the composite's leading column
-- covers status-only lookups), so drop it to avoid duplicate write/storage cost.

CREATE INDEX IF NOT EXISTS idx_bookings_group_id ON public.bookings (group_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status_start ON public.bookings (status, start_time);

DROP INDEX IF EXISTS public.idx_bookings_status;
