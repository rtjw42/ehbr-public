-- C2 refinement: post a FRESH board message each ISO week, edit within the week.
-- The Monday rollover tick already sets dirty; the Edge Function decides fresh vs
-- edit by comparing the current SGT week start against this stored value. A new
-- week (or a first-ever post) → send fresh + record the new week; same week → edit
-- the stored message in place. No delete, ever — last week's board just stays put.

alter table public.telegram_channel_state
  add column if not exists week_start timestamptz;
