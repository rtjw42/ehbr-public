-- pg_cron logs every run to cron.job_run_details and NEVER prunes it. The every-5-min
-- warm-edge-functions job adds ~288 rows/day, so that table would grow unbounded. Add a
-- daily purge that keeps 7 days of history — enough to debug a failing job, bounded
-- forever (~2k rows steady state). Purges by start_time (always set) so even a crashed
-- run with a null end_time still ages out.
--
-- (net._http_response needs no such job — pg_net auto-deletes responses after 6h.)

do $$
begin
  perform cron.unschedule('purge-cron-history');
exception
  when others then null;
end
$$;

select cron.schedule(
  'purge-cron-history',
  '17 3 * * *',  -- daily at 03:17, off-peak
  $$ delete from cron.job_run_details where start_time < now() - interval '7 days' $$
);
