-- Anonymous Auth identities must not inherit account-profile or wallet rows.
-- This migration does not enable Anonymous Auth; the later, separate guest Chess
-- migration adds only the room/move/takeover RPCs required by that feature.

create or replace function private.is_current_user_anonymous()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_anonymous from auth.users as u where u.id = (select auth.uid())),
    false
  );
$$;
revoke all on function private.is_current_user_anonymous() from public, anon;
grant execute on function private.is_current_user_anonymous() to authenticated;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_handle text;
begin
  -- Supabase anonymous users have role `authenticated`; do not create the
  -- account/profile or wallet rows that the existing email signup trigger adds.
  if coalesce(new.is_anonymous, false) then return new; end if;

  v_display_name := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    ),
    32
  );
  v_handle := 'p_' || pg_catalog.substr(pg_catalog.replace(new.id::text, '-', ''), 1, 12);

  insert into public.profiles (id, handle, display_name)
  values (new.id, v_handle, v_display_name)
  on conflict (id) do nothing;

  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

-- Also deny rows if an anonymous identity was provisioned before this guard.
drop policy if exists "Users can read their own and room participants profiles" on public.profiles;
create policy "Users can read their own and room participants profiles"
  on public.profiles for select to authenticated
  using (
    not (select private.is_current_user_anonymous())
    and (
      (select auth.uid()) = id
      or exists (
        select 1
        from public.room_members as target_member
        join public.room_members as viewer_member on viewer_member.room_id = target_member.room_id
        where target_member.user_id = profiles.id
          and viewer_member.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Users can update their own display name" on public.profiles;
create policy "Users can update their own display name"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id and not (select private.is_current_user_anonymous()))
  with check ((select auth.uid()) = id and not (select private.is_current_user_anonymous()));

drop policy if exists "Users can read their own wallet" on public.wallets;
create policy "Users can read their own wallet"
  on public.wallets for select to authenticated
  using ((select auth.uid()) = user_id and not (select private.is_current_user_anonymous()));

drop policy if exists "Users can read their own currency ledger" on public.currency_ledger;
create policy "Users can read their own currency ledger"
  on public.currency_ledger for select to authenticated
  using ((select auth.uid()) = user_id and not (select private.is_current_user_anonymous()));
