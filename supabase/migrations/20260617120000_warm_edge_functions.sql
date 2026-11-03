-- Keep the public Edge Functions warm so interactive requests don't pay an Edge
-- Function cold start. submit-booking can't move off the Edge Function (the
-- Turnstile secret + rate-limit + insert must stay server-side), so instead a
-- pg_cron job pings all three public functions every 5 minutes via pg_net; each
-- function answers the ping with an immediate 200 doing zero work (see
-- isWarmupRequest / warmupResponse in supabase/functions/_shared/security.ts).
--
-- NO secrets live in this migration — the helper reads them from Vault at run
-- time, so this is safe to commit/ship. Configure the three Vault secrets + the
-- WARMUP_SECRET Edge Function secret ONCE, out of band (see
-- docs/agent/OPERATIONS.md → "Edge Function warm-up"):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon / publishable key>',          'edge_anon_key');
--   select vault.create_secret('<random 32+ char token>',           'warmup_secret');
-- and set the SAME token as WARMUP_SECRET on the Edge Functions. Until all three
-- secrets exist the job is a safe no-op, so apply order doesn't matter.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Pings the three public functions. SECURITY DEFINER so it can read Vault; reads
-- the project URL, anon key (to clear the gateway) and the warmup token from Vault.
create or replace function private.warm_edge_functions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base   text;
  v_key    text;
  v_secret text;
  v_fn     text;
begin
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key    from vault.decrypted_secrets where name = 'edge_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'warmup_secret';

  -- Not configured yet → no-op (don't error the cron tick).
  if v_base is null or v_key is null or v_secret is null then
    return;
  end if;

  foreach v_fn in array array['submit-booking', 'register-admin', 'request-password-reset'] loop
    perform net.http_post(
      url     := v_base || '/functions/v1/' || v_fn,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'apikey',          v_key,
        'Authorization',   'Bearer ' || v_key,
        'x-warmup-secret', v_secret
      ),
      body    := jsonb_build_object('warmup', true)
    );
  end loop;
end;
$$;

revoke all on function private.warm_edge_functions() from public, anon, authenticated;

-- Re-schedule idempotently so re-running this migration doesn't duplicate the job.
do $$
begin
  perform cron.unschedule('warm-edge-functions');
exception
  when others then null;
end
$$;

select cron.schedule(
  'warm-edge-functions',
  '*/5 * * * *',
  $$ select private.warm_edge_functions(); $$
);
