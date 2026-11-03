-- Reproducibility: public.bookings is in the supabase_realtime publication — the
-- public booking calendar + landing page rely on postgres_changes on it — but it
-- was enabled via the dashboard, never in a migration. So a from-zero rebuild
-- (disaster recovery, fresh project) would silently ship a calendar with no live
-- updates. Add it here idempotently. The other realtime tables (events,
-- backline_*, site_contact*) are already added by earlier migrations.
--
-- Behaviour-neutral on the live DB: the guard skips the ADD when it's already a
-- member, so applying this changes nothing where it's already set.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end
$$;
