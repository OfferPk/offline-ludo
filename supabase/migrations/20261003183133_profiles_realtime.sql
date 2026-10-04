-- Online Ludo profile display-name changes are visible only under the existing
-- member-scoped profiles SELECT policy. This enables those allowed rows to emit
-- Realtime events so account and room-roster views can refresh live.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;
