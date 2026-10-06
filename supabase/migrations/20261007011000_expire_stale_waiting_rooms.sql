-- A waiting room's invite expires after 24 hours. Retire old lobbies so
-- Quick Match and saved-room recovery do not keep surfacing abandoned tables.
-- This never mutates active games, room membership, match history, or wallets.
create index if not exists rooms_waiting_stale_cleanup_idx
  on public.rooms (created_at, id)
  where status = 'waiting';

create or replace function public.expire_stale_waiting_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expired integer;
begin
  if v_user is null then
    raise exception 'Sign in is required' using errcode = '28000';
  end if;

  with stale_rooms as (
    select r.id
    from public.rooms as r
    where r.status = 'waiting'
      and r.created_at <= v_now - interval '24 hours'
    order by r.created_at, r.id
    limit 500
    for update skip locked
  )
  update public.rooms as r
  set status = 'cancelled',
      finished_at = v_now,
      updated_at = v_now
  from stale_rooms as stale
  where r.id = stale.id
    and r.status = 'waiting';

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

revoke all on function public.expire_stale_waiting_rooms() from public, anon;
grant execute on function public.expire_stale_waiting_rooms() to authenticated;
