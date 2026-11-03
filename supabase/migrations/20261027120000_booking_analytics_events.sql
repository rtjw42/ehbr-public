-- ── Booking analytics: two anonymous, append-only event logs ─────────────────
-- booking_events makes approval wait and declines measurable. Neither survives in
-- public.bookings itself: declining a request hard-deletes the row, and
-- updated_at moves on every edit. A trigger records each status change as it
-- happens, with the wait computed at that moment.
--
-- funnel_events counts the public booking-form steps. Only the log-funnel-step
-- Edge Function writes it, through record_funnel_step, and only after consent.
--
-- Neither table holds a booking id, name, title, notes or IP address. Both live
-- in public (so the nightly backup, which dumps only public, keeps them) and are
-- locked like telegram_channel_state: RLS on, zero policies, every grant revoked
-- from anon and authenticated. Read them in the SQL editor.

create table public.booking_events (
  id           bigint generated always as identity primary key,
  event        text not null check (event in (
                 'submitted', 'approved', 'declined', 'bumped', 'cancelled', 'admin_created'
               )),
  -- Counts requests vs sessions: a grouped request writes one row per session.
  group_id     uuid,
  -- Session start, so lead time and notice-before-session survive a delete.
  starts_at    timestamptz not null,
  -- Request age when an admin decided it ('approved' / 'declined' only).
  wait_seconds integer,
  occurred_at  timestamptz not null default now()
);

alter table public.booking_events enable row level security;
revoke all on public.booking_events from public, anon, authenticated;

create table public.funnel_events (
  id          bigint generated always as identity primary key,
  step        text not null check (step in ('page_view', 'form_open', 'review', 'verify', 'submitted')),
  -- Hour bucket only: enough for time-of-day patterns, too coarse to single out a visit.
  occurred_at timestamptz not null default date_trunc('hour', now())
);

alter table public.funnel_events enable row level security;
revoke all on public.funnel_events from public, anon, authenticated;

-- ── booking_events writer ────────────────────────────────────────────────────
-- SECURITY DEFINER so a trigger fired by an admin's SECURITY INVOKER RPC (or the
-- service-role submission path) can write a table no caller can touch.

create or replace function private.log_booking_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     public.bookings%rowtype;
  v_event text;
begin
  if tg_op = 'DELETE' then
    r := old;
    v_event := case old.status when 'pending' then 'declined' when 'approved' then 'cancelled' end;
  elsif tg_op = 'INSERT' then
    r := new;
    v_event := case new.status when 'pending' then 'submitted' when 'approved' then 'admin_created' end;
  else
    r := new;
    v_event := case
      when old.status = 'pending'  and new.status = 'approved' then 'approved'
      when old.status = 'pending'  and new.status = 'rejected' then 'declined'
      when old.status = 'approved' and new.status = 'rejected' then 'bumped'
    end;
  end if;

  if v_event is null then
    return null;
  end if;

  insert into public.booking_events (event, group_id, starts_at, wait_seconds)
  values (
    v_event,
    r.group_id,
    r.start_time,
    case when v_event in ('approved', 'declined')
      then extract(epoch from now() - r.created_at)::integer
    end
  );
  return null;
end;
$$;

revoke all on function private.log_booking_event() from public, anon, authenticated;

create trigger booking_events_ins
  after insert on public.bookings
  for each row execute function private.log_booking_event();

create trigger booking_events_upd
  after update of status on public.bookings
  for each row when (old.status is distinct from new.status)
  execute function private.log_booking_event();

create trigger booking_events_del
  after delete on public.bookings
  for each row execute function private.log_booking_event();

-- ── funnel_events writer ─────────────────────────────────────────────────────
-- Service-role only, behind log-funnel-step (CORS, size cap, enum check, per-IP
-- rate limit). The check constraint is the final word on which steps exist.

create or replace function public.record_funnel_step(_step text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.funnel_events (step) values (_step);
$$;

revoke all on function public.record_funnel_step(text) from public, anon, authenticated;
grant execute on function public.record_funnel_step(text) to service_role;
