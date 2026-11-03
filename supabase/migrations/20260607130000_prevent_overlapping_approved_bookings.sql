-- Make overlapping APPROVED bookings impossible at the database level.
--
-- Until now, two approved bookings couldn't overlap thanks to the admin UI's conflict
-- check and the approval RPCs' overlap checks + row locks. Those cover normal use, but
-- a true millisecond-level concurrent double-approval (two admins, two devices, the same
-- instant) could in theory slip past a check-then-write window. This partial exclusion
-- constraint closes that window atomically: Postgres itself rejects any second approved
-- booking whose time range overlaps an existing approved one.
--
-- The pending path is unaffected (the constraint is WHERE status = 'approved'), so public
-- requests still queue freely; only the approved set is kept non-overlapping. The
-- approve-overwrite RPC rejects the conflicting approved row before approving the target,
-- so it stays within the constraint. A violation surfaces as the existing client message
-- "That time is no longer available." (normalizeBookingError already matches the name).
--
-- NOTE: if this migration fails to apply, the remote DB already contains overlapping
-- approved bookings — reject the duplicates, then re-run.

ALTER TABLE public.bookings
  ADD CONSTRAINT no_approved_overlap
  EXCLUDE USING gist (
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (status = 'approved');
