-- Move the weekly board rollover from Sunday 18:00 SGT to Sunday 19:00 SGT (7pm),
-- matching the board window lead (BOARD_WEEK_LEAD_MS = 5h). pg_cron runs in GMT;
-- SGT is fixed UTC+8 with no DST, so Sunday 19:00 SGT = Sunday 11:00 UTC. The tick
-- only sets the dirty flag — the 1-min drain sends.
do $$
begin
  perform cron.unschedule('telegram-board-rollover');
exception
  when others then null;
end
$$;

select cron.schedule(
  'telegram-board-rollover',
  '0 11 * * 0',
  $$ update public.telegram_channel_state set dirty = true, updated_at = now() where id = 1; $$
);
