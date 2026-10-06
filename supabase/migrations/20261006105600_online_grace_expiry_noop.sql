-- Do not bump a live match version when no reconnect window has expired.
-- A client clock can be ahead of the server and legitimately request expiry early.
create or replace function public.expire_grace(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_version bigint;
  v_state jsonb;
  v_seat integer;
  v_active integer := 0;
  v_players jsonb;
  v_i integer;
  v_candidate integer;
  v_expired_count integer := 0;
begin
  if v_user is null then
    raise exception 'Sign in is required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.room_members as rm
    where rm.room_id = p_room_id and rm.user_id = v_user
  ) then
    raise exception 'You are not a member of this room' using errcode = '42501';
  end if;

  perform 1 from public.rooms as r
  where r.id = p_room_id and r.status = 'active'
  for update;
  if not found then
    raise exception 'Room is not active' using errcode = '55000';
  end if;

  select ms.version, ms.state into v_version, v_state
  from public.match_states as ms
  where ms.room_id = p_room_id
  for update;
  if not found then
    raise exception 'Authoritative match state is unavailable' using errcode = 'P0002';
  end if;

  for v_seat in
    select rm.seat from public.room_members as rm
    where rm.room_id = p_room_id
      and rm.disconnected_at is not null
      and rm.disconnected_at < now() - interval '20 seconds'
  loop
    if not (coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_seat)) then
      v_state := pg_catalog.jsonb_set(
        v_state,
        '{abandoned}',
        coalesce(v_state->'abandoned', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_seat),
        true
      );
    end if;
    if (v_state #>> '{grace,seat}') is not null
       and (v_state #>> '{grace,seat}')::integer = v_seat then
      v_state := pg_catalog.jsonb_set(v_state, '{grace}', 'null'::jsonb, true);
    end if;
    update public.room_members
    set disconnected_at = null
    where room_id = p_room_id and seat = v_seat;
    v_expired_count := v_expired_count + 1;
  end loop;

  -- A premature or duplicate request is a true no-op: preserve the version so
  -- it cannot make an otherwise valid, in-flight turn action stale.
  if v_expired_count = 0 then
    return pg_catalog.jsonb_build_object(
      'room_id', p_room_id,
      'expired', false,
      'version', v_version,
      'state', v_state
    );
  end if;

  v_players := v_state->'players';
  if v_players is not null then
    for v_i in 0..pg_catalog.jsonb_array_length(v_players) - 1 loop
      v_candidate := (v_players->>v_i)::integer;
      if not (coalesce(v_state->'ranking', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_candidate))
         and not (coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_candidate)) then
        v_active := v_active + 1;
      end if;
    end loop;
  end if;

  if v_active < 2 then
    v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
    v_state := pg_catalog.jsonb_set(v_state, '{result}', '"abandoned"'::jsonb, true);
    v_state := pg_catalog.jsonb_set(v_state, '{turn_deadline}', 'null'::jsonb, true);
    update public.rooms
    set status = 'completed', finished_at = now(), updated_at = now()
    where id = p_room_id;
    update public.match_history
    set status = 'completed',
        result = pg_catalog.jsonb_build_object('result', 'abandoned', 'state', v_state),
        finished_at = now()
    where room_id = p_room_id and status = 'active';
  elsif coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array((v_state->>'turn')::integer) then
    v_state := private.online_ludo_next_turn(v_state);
    v_state := private.online_ludo_arm_clock(v_state);
  end if;

  update public.match_states
  set version = v_version + 1, state = v_state, updated_at = now()
  where room_id = p_room_id;
  return pg_catalog.jsonb_build_object(
    'room_id', p_room_id,
    'version', v_version + 1,
    'state', v_state
  );
end;
$$;

revoke all on function public.expire_grace(uuid) from public, anon;
grant execute on function public.expire_grace(uuid) to authenticated;
