-- Deep health check for the four public Edge Functions, every 15 minutes.
--
-- The warm-up ping (20260617120000) returns 200 before checking anything, so it
-- cannot notice a missing RATE_LIMIT_SALT (every booking 500s), missing Telegram
-- config (requests accepted, admins never pinged) or a broken database path. This
-- job sends each function the warm-up secret plus `x-health: deep`; the function
-- verifies what it depends on and reports to Healthchecks.io itself (see
-- supabase/functions/_shared/health.ts). A paused project stops this job too, and
-- the missing pings are what alert, so the watcher sits outside Supabase.
--
-- NO secrets live here: it reads the same Vault secrets as the warm-up job
-- (project_url, edge_anon_key, warmup_secret) and is a safe no-op until they exist.
-- HEALTHCHECKS_PING_KEY is an Edge Function secret, not a Vault one: see
-- docs/agent/OPERATIONS.md → "Health checks".

create or replace function private.health_check_edge_functions()
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

  foreach v_fn in array array['submit-booking', 'register-admin', 'request-password-reset', 'log-funnel-step'] loop
    perform net.http_post(
      url     := v_base || '/functions/v1/' || v_fn,
      headers := jsonb_build_object(
        'Content-Type',    'application/json',
        'apikey',          v_key,
        'Authorization',   'Bearer ' || v_key,
        'x-warmup-secret', v_secret,
        'x-health',        'deep'
      ),
      body    := jsonb_build_object('health', true)
    );
  end loop;
end;
$$;

revoke all on function private.health_check_edge_functions() from public, anon, authenticated;

-- Re-schedule idempotently so re-running this migration doesn't duplicate the job.
do $$
begin
  perform cron.unschedule('health-check-edge-functions');
exception
  when others then null;
end
$$;

select cron.schedule(
  'health-check-edge-functions',
  '*/15 * * * *',
  $$ select private.health_check_edge_functions(); $$
);

-- Housekeeping from the 2026-09-16 sweep that missed 20261027120000: the one RPC
-- whose default grants were never revoked. Pure sha256 with no secret, so harmless.
-- Its only callers, security_is_valid_admin_invite and the signup trigger
-- handle_admin_invite_signup, are SECURITY DEFINER and owned by postgres, so they
-- keep working; the app never calls it directly (checked 2026-11-01).
revoke all on function public.hash_admin_invite_code(text) from public, anon, authenticated;
