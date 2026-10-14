-- Keep repeated disconnect notifications from restarting a participant's
-- server-authoritative reconnect grace window.
create or replace function public.note_disconnect(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_seat integer;
  v_disconnected_at timestamptz;
  v_version bigint;
  v_state jsonb;
  v_until bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select rm.seat into v_seat
  from public.room_members as rm
  where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;

  perform 1 from public.rooms as r where r.id = p_room_id and r.status = 'active' for update;
  if not found then raise exception 'Room is not active' using errcode = '55000'; end if;
  select ms.version, ms.state into v_version, v_state
  from public.match_states as ms where ms.room_id = p_room_id for update;
  if not found then raise exception 'Authoritative match state is unavailable' using errcode = 'P0002'; end if;

  -- Re-read after the room/state locks: concurrent duplicate calls must observe
  -- the first call's timestamp rather than moving the deadline forward.
  select rm.seat, rm.disconnected_at into v_seat, v_disconnected_at
  from public.room_members as rm
  where rm.room_id = p_room_id and rm.user_id = v_user
  for update;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;

  if v_disconnected_at is not null then
    return pg_catalog.jsonb_build_object(
      'room_id', p_room_id,
      'seat', v_seat,
      'grace_ms', 20000,
      'version', v_version,
      'state', v_state,
      'duplicate', true
    );
  end if;

  v_disconnected_at := pg_catalog.clock_timestamp();
  update public.room_members
  set disconnected_at = v_disconnected_at
  where room_id = p_room_id and user_id = v_user;
  v_until := (pg_catalog.date_part('epoch', v_disconnected_at) * 1000)::bigint + 20000;
  v_state := pg_catalog.jsonb_set(
    v_state,
    '{grace}',
    pg_catalog.jsonb_build_object('seat', v_seat, 'until', v_until),
    true
  );
  update public.match_states
  set version = v_version + 1, state = v_state, updated_at = pg_catalog.clock_timestamp()
  where room_id = p_room_id;
  return pg_catalog.jsonb_build_object(
    'room_id', p_room_id,
    'seat', v_seat,
    'grace_ms', 20000,
    'version', v_version + 1,
    'state', v_state,
    'duplicate', false
  );
end;
$$;

revoke all on function public.note_disconnect(uuid) from public, anon;
grant execute on function public.note_disconnect(uuid) to authenticated;
