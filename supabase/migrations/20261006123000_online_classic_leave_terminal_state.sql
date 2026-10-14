-- Keep an active Online Classic departure consistent across room, history, and
-- the authoritative match row. The room is still cancelled as before; only the
-- stale live Classic state is terminalized. Waiting rooms and Chess are unchanged.
create or replace function public.leave_room(p_room_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_seat integer;
  v_version bigint;
  v_state jsonb;
  v_abandoned jsonb;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;

  select r.* into v_room
  from public.rooms as r
  where r.id = p_room_id
  for update;
  if not found then return false; end if;

  select rm.seat into v_seat
  from public.room_members as rm
  where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;

  if v_room.status = 'active' then
    if v_room.mode = 'classic' then
      select ms.version, ms.state into v_version, v_state
      from public.match_states as ms
      where ms.room_id = p_room_id
      for update;

      if found and v_state->>'phase' is distinct from 'over' then
        v_abandoned := coalesce(v_state->'abandoned', '[]'::jsonb);
        if not (v_abandoned @> pg_catalog.jsonb_build_array(v_seat)) then
          v_abandoned := v_abandoned || pg_catalog.jsonb_build_array(v_seat);
        end if;
        v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
        v_state := pg_catalog.jsonb_set(v_state, '{result}', '"abandoned"'::jsonb, true);
        v_state := pg_catalog.jsonb_set(v_state, '{queue}', '[]'::jsonb, true);
        v_state := pg_catalog.jsonb_set(v_state, '{bonus}', '0'::jsonb, true);
        v_state := pg_catalog.jsonb_set(v_state, '{roll_again}', 'false'::jsonb, true);
        v_state := pg_catalog.jsonb_set(v_state, '{grace}', 'null'::jsonb, true);
        v_state := pg_catalog.jsonb_set(v_state, '{turn_deadline}', 'null'::jsonb, true);
        v_state := pg_catalog.jsonb_set(v_state, '{abandoned}', v_abandoned, true);
        v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.jsonb_build_object('type', 'leave', 'seat', v_seat), true);

        update public.match_states
        set version = v_version + 1, state = v_state, updated_at = now()
        where room_id = p_room_id;
      end if;
    end if;

    update public.rooms set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_room_id;
    update public.match_history
    set status = 'abandoned', finished_at = now(), result = '{"reason":"player_left"}'::jsonb
    where room_id = p_room_id and status = 'active';
  elsif v_room.status = 'waiting' and v_room.created_by = v_user then
    update public.rooms set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_room_id;
  elsif v_room.status = 'waiting' then
    delete from public.room_members where room_id = p_room_id and user_id = v_user;
    update public.rooms set updated_at = now() where id = p_room_id;
  end if;

  return true;
end;
$$;

revoke all on function public.leave_room(uuid) from public, anon;
grant execute on function public.leave_room(uuid) to authenticated;
