-- The safety-net booking reminder: once a day at 10:00 SGT, ask the
-- `telegram-reminder` Edge Function to remind the admin chat about requests still
-- pending close to their first session. The rule lives in the function
-- (supabase/functions/_shared/booking-reminder.ts), and its window assumes this
-- schedule, so keep the two in step.
--
-- NO secrets live here: it reads the same Vault secrets as the board drain
-- (project_url, edge_anon_key, telegram_trigger_secret) and is a safe no-op until
-- they exist. Bearer anon key clears the gateway's default verify_jwt; the
-- function's real guard is the x-telegram-trigger-secret header.
--
-- To stop it without a deploy: select cron.unschedule('telegram-booking-reminder');

create or replace function private.send_booking_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base   text;
  v_key    text;
  v_secret text;
begin
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key    from vault.decrypted_secrets where name = 'edge_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'telegram_trigger_secret';

  -- Not configured yet → no-op (don't error the cron tick).
  if v_base is null or v_key is null or v_secret is null then
    return;
  end if;

  -- One shot with no retry, so allow a cold start plus a few sends.
  perform net.http_post(
    url     := v_base || '/functions/v1/telegram-reminder',
    headers := jsonb_build_object(
      'Content-Type',              'application/json',
      'apikey',                    v_key,
      'Authorization',             'Bearer ' || v_key,
      'x-telegram-trigger-secret', v_secret
    ),
    body    := jsonb_build_object('reminder', true),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function private.send_booking_reminders() from public, anon, authenticated;

-- Re-schedule idempotently so re-running this migration doesn't duplicate the job.
do $$
begin
  perform cron.unschedule('telegram-booking-reminder');
exception
  when others then null;
end
$$;

-- 10:00 SGT = 02:00 UTC (pg_cron runs in GMT; SGT is fixed UTC+8, no DST).
select cron.schedule(
  'telegram-booking-reminder',
  '0 2 * * *',
  $$ select private.send_booking_reminders(); $$
);
