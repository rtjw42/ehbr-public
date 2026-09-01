-- C2: band-chat weekly board — dirty-flag state + thin trigger + pg_cron drain.
--
-- Any approved-booking change (approve / edit-of-approved / delete-of-approved)
-- sets `dirty` on a singleton state row; a 1-minute pg_cron drain sees the flag
-- and pg_net-posts to the `telegram-weekly` Edge Function, which rebuilds the
-- board from live DB state, sends/edits the Telegram message, and clears the
-- flag only on success (a failed send retries next tick; a bulk-approve burst
-- coalesces into one send per minute). A Monday 00:05 SGT tick sets the flag so
-- the board rolls to the new week even when nothing else changed.
--
-- NO secrets live in this migration — the drain reads them from Vault at run
-- time, so this is safe to commit/ship. Configure ONCE, out of band (see
-- docs/agent/OPERATIONS.md → "Telegram outbound"): the drain reuses the warmup Vault
-- secrets `project_url` + `edge_anon_key`, plus one new Vault secret holding the
-- SAME value as the TELEGRAM_TRIGGER_SECRET Edge Function secret:
--   select vault.create_secret('<same value as TELEGRAM_TRIGGER_SECRET>', 'telegram_trigger_secret');
-- Until all three exist the drain is a safe no-op, so apply order doesn't matter.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Singleton state row ──────────────────────────────────────────────────────
-- RLS on, ZERO policies: only the service role (the Edge Function) and definer
-- functions ever touch it. message_id/chat_id remember the posted board so the
-- next drain can edit in place; dirty is the rebuild-needed flag.

create table public.telegram_channel_state (
  id int primary key default 1 check (id = 1),
  message_id bigint,
  chat_id text,
  dirty boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.telegram_channel_state enable row level security;

revoke all on table public.telegram_channel_state from public, anon, authenticated;

insert into public.telegram_channel_state (id, dirty) values (1, false)
on conflict (id) do nothing;

-- ── Thin trigger: flag only, no HTTP in the booking transaction ──────────────
-- SECURITY DEFINER because approvals/deletes run under various roles (definer
-- RPCs, authenticated admins) and none of them have a policy on the state row.

create or replace function private.flag_telegram_board_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.telegram_channel_state
     set dirty = true, updated_at = now()
   where id = 1 and dirty = false;
  return null;
end;
$$;

revoke all on function private.flag_telegram_board_dirty() from public, anon, authenticated;

-- Three triggers so each WHEN clause only references the row it legally can
-- (INSERT has no OLD, DELETE has no NEW). Only approved rows affect the board.
create trigger telegram_board_dirty_ins
  after insert on public.bookings
  for each row when (new.status = 'approved')
  execute function private.flag_telegram_board_dirty();

create trigger telegram_board_dirty_upd
  after update on public.bookings
  for each row when (old.status = 'approved' or new.status = 'approved')
  execute function private.flag_telegram_board_dirty();

create trigger telegram_board_dirty_del
  after delete on public.bookings
  for each row when (old.status = 'approved')
  execute function private.flag_telegram_board_dirty();

-- ── Drain: 1-min cron, posts to telegram-weekly only when dirty ──────────────
-- The Edge Function clears `dirty` (claim-then-send: flips it false up front,
-- re-sets it on failure) so a Telegram outage gets a free retry next tick.
-- Bearer anon key clears the gateway's default verify_jwt; the function's real
-- guard is the x-telegram-trigger-secret header.

create or replace function private.drain_telegram_board()
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
  if not exists (select 1 from public.telegram_channel_state where id = 1 and dirty) then
    return;
  end if;

  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key    from vault.decrypted_secrets where name = 'edge_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'telegram_trigger_secret';

  -- Not configured yet → no-op (don't error the cron tick).
  if v_base is null or v_key is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_base || '/functions/v1/telegram-weekly',
    headers := jsonb_build_object(
      'Content-Type',              'application/json',
      'apikey',                    v_key,
      'Authorization',             'Bearer ' || v_key,
      'x-telegram-trigger-secret', v_secret
    ),
    body    := jsonb_build_object('drain', true)
  );
end;
$$;

revoke all on function private.drain_telegram_board() from public, anon, authenticated;

-- Re-schedule idempotently so re-running this migration doesn't duplicate jobs.
do $$
begin
  perform cron.unschedule('telegram-board-drain');
exception
  when others then null;
end
$$;

select cron.schedule(
  'telegram-board-drain',
  '* * * * *',
  $$ select private.drain_telegram_board(); $$
);

-- Weekly rollover: Monday 00:05 SGT = Sunday 16:05 UTC (pg_cron runs in GMT;
-- SGT is fixed UTC+8, no DST). Just sets the flag — the drain does the rest.
do $$
begin
  perform cron.unschedule('telegram-board-rollover');
exception
  when others then null;
end
$$;

select cron.schedule(
  'telegram-board-rollover',
  '5 16 * * 0',
  $$ update public.telegram_channel_state set dirty = true, updated_at = now() where id = 1; $$
);
