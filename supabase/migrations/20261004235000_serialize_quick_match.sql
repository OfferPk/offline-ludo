-- Serialize concurrent quick-match claims within each mode/capacity bucket.
-- Without this transaction-scoped lock, concurrent callers can both inspect the
-- same eligible waiting room; FOR UPDATE SKIP LOCKED makes the later caller skip
-- it and create/join a different table instead of filling the same match.
create or replace function public.quick_match(p_mode text, p_capacity integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
  v_room public.rooms%rowtype;
  v_code text;
  v_seat integer;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic','mystery','lucky','ludo_chess') then raise exception 'Unsupported game mode' using errcode = '22023'; end if;
  if p_capacity not in (2,3,4) or (p_mode = 'ludo_chess' and p_capacity <> 2) then raise exception 'Ludo Chess requires exactly two seats; other modes support 2, 3, or 4' using errcode = '22023'; end if;

  -- All quick-match calls for this bucket observe the preceding transaction's
  -- membership insert before selecting a room. Hash collisions only serialize
  -- unrelated buckets; they cannot weaken matching correctness.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('online_quick_match:' || p_mode || ':' || p_capacity::text, 0)
  );

  select r.id into v_room_id
  from public.rooms as r
  join public.room_members as own_member on own_member.room_id = r.id and own_member.user_id = v_user
  where r.status in ('waiting','active') and r.mode = p_mode and r.capacity = p_capacity
  order by r.created_at desc
  limit 1;
  if v_room_id is not null then
    select i.invite_code into v_code
    from public.room_invites as i
    where i.room_id = v_room_id
    order by i.created_at desc
    limit 1;
    return pg_catalog.jsonb_build_object(
      'room_id', v_room_id,
      'invite_code', v_code,
      'status', (select r.status from public.rooms as r where r.id = v_room_id)
    );
  end if;

  select r.id into v_room_id
  from public.rooms as r
  where r.status = 'waiting'
    and r.mode = p_mode
    and r.capacity = p_capacity
    and (select pg_catalog.count(*) from public.room_members as rm where rm.room_id = r.id) < r.capacity
  order by r.created_at
  limit 1
  for update skip locked;

  if v_room_id is null then
    return public.create_room(p_mode, p_capacity);
  end if;

  select r.* into v_room from public.rooms as r where r.id = v_room_id;
  select seats.seat_no into v_seat
  from pg_catalog.generate_series(0, v_room.capacity - 1) as seats(seat_no)
  where not exists (
    select 1 from public.room_members as rm
    where rm.room_id = v_room_id and rm.seat = seats.seat_no
  )
  order by seats.seat_no
  limit 1;

  insert into public.room_members (room_id, user_id, seat, role, ready)
  values (v_room_id, v_user, v_seat, 'player', false);
  update public.rooms set updated_at = now() where id = v_room_id;
  select i.invite_code into v_code
  from public.room_invites as i
  where i.room_id = v_room_id
  order by i.created_at desc
  limit 1;
  return pg_catalog.jsonb_build_object(
    'room_id', v_room_id,
    'invite_code', v_code,
    'status', v_room.status
  );
end;
$$;

revoke all on function public.quick_match(text, integer) from public, anon;
grant execute on function public.quick_match(text, integer) to authenticated;
