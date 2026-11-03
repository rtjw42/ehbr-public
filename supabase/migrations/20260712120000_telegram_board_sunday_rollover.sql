-- Move the weekly board rollover from Monday 00:05 SGT to Sunday 18:00 SGT.
--
-- The board now previews the UPCOMING week from Sunday evening: the Edge board
-- window carries a 6h lead (BOARD_WEEK_LEAD_MS in _shared/telegram-format.ts), and
-- the function sends a one-off "Next week's bookings!" ping ahead of the fresh
-- board on rollover. This tick must fire at the same moment the window advances.
--
-- pg_cron runs in GMT; SGT is fixed UTC+8 with no DST, so Sunday 18:00 SGT =
-- Sunday 10:00 UTC. The tick only sets the dirty flag — the 1-min drain sends.
do $$
begin
  perform cron.unschedule('telegram-board-rollover');
exception
  when others then null;
end
$$;

select cron.schedule(
  'telegram-board-rollover',
  '0 10 * * 0',
  $$ update public.telegram_channel_state set dirty = true, updated_at = now() where id = 1; $$
);
