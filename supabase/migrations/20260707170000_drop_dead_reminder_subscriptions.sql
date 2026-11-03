-- Phase 3 (DB health): drop the dead reminder_subscriptions table.
--
-- An email-reminder feature (double-opt-in: email / confirmed / unsubscribe_token)
-- that was designed but never wired into the app. Public insert was disabled on
-- 2026-05-06 (20260506093000); the table has sat at 0 rows, is referenced nowhere in
-- src/ or supabase/functions/ (only in the generated types.ts), and all three of its
-- indexes show zero scans in pg_stat_user_indexes.
--
-- Dropping it removes a PII surface (the `email` column — the one the backup plan
-- flagged) and unused weight. Leaf table: nothing FKs into it and no function/view
-- depends on it, so its policies, indexes, and constraints drop with it. Owner-approved
-- 2026-07-07. Regenerate src/integrations/supabase/types.ts after applying.

DROP TABLE IF EXISTS public.reminder_subscriptions;
