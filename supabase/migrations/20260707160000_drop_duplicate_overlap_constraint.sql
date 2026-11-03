-- Phase 3 (DB health): drop a redundant duplicate exclusion constraint.
--
-- The bookings table carries TWO functionally identical GiST exclusion constraints,
-- both enforcing "no two APPROVED bookings may overlap":
--   * bookings_no_approved_overlap  (added 20260430090000)
--   * no_approved_overlap           (added 20260607130000)
-- Each backs its own GiST index, so every approved-booking write paid to maintain the
-- rule twice. Confirmed present on the live DB via pg_constraint (Phase 3 audit).
--
-- Keep no_approved_overlap: it is the name referenced by the client error handler
-- (src/services/bookings.ts normalizeBookingError), its tests, and code comments.
-- Dropping the constraint drops its backing index automatically. No behaviour change:
-- the surviving constraint enforces the identical rule.
--
-- Forward-only fix: on a from-zero replay this runs after both ADD CONSTRAINTs and
-- leaves exactly one, keeping disaster-recovery rebuilds correct too.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_no_approved_overlap;
