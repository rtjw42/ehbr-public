-- pg_net's 6h TTL bounds the ROW count of net._http_response, not its SIZE. The
-- deletes run in pg_net's background worker and never reach the table's stats
-- (n_dead_tup stays 0), so autovacuum never triggers, dead rows are never marked
-- reusable, and every response appends to the heap: ~1 MB/day from the warm-up
-- pings alone. Measured 2026-10-22: 76 MB heap holding 216 live rows (238 kB), last
-- autovacuum 2026-08-05. This corrects the "needs no such job" note in
-- 20260617130000_purge_cron_history.sql.
--
-- Fix: a nightly plain VACUUM, so freed space is reused and the heap stays at a few
-- hundred kB. `postgres` holds MAINTAIN on the table (owner is supabase_admin, PG17),
-- so the job isn't silently skipped. The table only holds responses nothing reads.

-- One-off: reclaim the existing bloat. Plain VACUUM can't shrink it, because the
-- live rows sit at the end of the heap; VACUUM FULL can't run inside a migration.
truncate net._http_response;

do $$
begin
  perform cron.unschedule('vacuum-http-response');
exception
  when others then null;
end
$$;

select cron.schedule(
  'vacuum-http-response',
  '30 19 * * *',  -- daily 19:30 UTC = 03:30 SGT, off-peak and clear of the 03:00 SGT backup
  $$ vacuum net._http_response $$
);
