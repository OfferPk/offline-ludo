-- Correct Classic completion detection with a forward-only replacement.
-- The historical migration is already applied; keep it immutable.

create or replace function public.move_match(p_room_id uuid, p_expected_version bigint, p_action_id uuid, p_piece integer, p_queue_index integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_member_seat integer;
  v_version bigint;
  v_state jsonb;
  v_room_status text;
  v_request jsonb;
  v_existing private.online_match_actions%rowtype;
  v_response jsonb;
  v_new_version bigint;
  v_queue jsonb;
  v_die integer;
  v_position integer;
  v_destination integer;
  v_from_abs integer;
  v_target_abs integer;
  v_other_seat integer;
  v_other_piece integer;
  v_other_position integer;
  v_captures jsonb := '[]'::jsonb;
  v_bonus integer;
  v_all_home boolean := false;
  v_i integer;
  v_player integer;
  v_winner_seat integer;
  v_winner uuid;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_action_id is null or p_expected_version is null or p_expected_version < 0
     or p_piece is null or p_queue_index is null or p_piece not between 0 and 3 or p_queue_index < 0 then
    raise exception 'Match action is invalid' using errcode = '22023';
  end if;
  select rm.seat into v_member_seat from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  select r.status into v_room_status from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select ms.version, ms.state into v_version, v_state from public.match_states as ms where ms.room_id = p_room_id for update;
  if not found then raise exception 'Authoritative match state is unavailable' using errcode = 'P0002'; end if;
  v_request := pg_catalog.jsonb_build_object('type', 'move', 'expected_version', p_expected_version, 'piece', p_piece, 'queue_index', p_queue_index);

  select a.* into v_existing from private.online_match_actions as a where a.room_id = p_room_id and a.action_id = p_action_id;
  if found then
    if v_existing.actor_id <> v_user or v_existing.request <> v_request then raise exception 'Action ID was reused for a different request' using errcode = '23505'; end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  if v_room_status <> 'active' then raise exception 'Room is not active' using errcode = '55000'; end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  if v_state->>'phase' <> 'move' then raise exception 'It is not the move phase' using errcode = '55000'; end if;
  if (v_state->>'turn')::integer <> v_member_seat then raise exception 'It is not your turn' using errcode = '42501'; end if;

  v_queue := coalesce(v_state->'queue', '[]'::jsonb);
  if p_queue_index >= pg_catalog.jsonb_array_length(v_queue) then raise exception 'Dice queue selection is invalid' using errcode = '22023'; end if;
  v_die := (v_queue->>p_queue_index)::integer;
  if not private.online_ludo_can_move(v_state, v_member_seat, p_piece, v_die) then
    raise exception 'That token cannot use the selected server die value' using errcode = '22023';
  end if;
  v_position := (v_state #>> array['pieces', v_member_seat::text, p_piece::text])::integer;
  v_destination := private.online_ludo_destination(v_position, v_die);
  v_state := pg_catalog.jsonb_set(v_state, array['pieces', v_member_seat::text, p_piece::text], pg_catalog.to_jsonb(v_destination), true);
  v_queue := v_queue - p_queue_index;
  v_state := pg_catalog.jsonb_set(v_state, '{queue}', v_queue, true);

  if v_destination between 0 and 51 then
    v_target_abs := (v_destination + 13 * v_member_seat) % 52;
    if v_target_abs <> all(array[0, 8, 13, 21, 26, 34, 39, 47]) then
      for v_other_seat in 0..3 loop
        if v_other_seat <> v_member_seat and v_state->'pieces'->v_other_seat is not null and v_state->'pieces'->v_other_seat <> 'null'::jsonb then
          for v_other_piece in 0..3 loop
            v_other_position := (v_state #>> array['pieces', v_other_seat::text, v_other_piece::text])::integer;
            if v_other_position between 0 and 51 then
              v_from_abs := (v_other_position + 13 * v_other_seat) % 52;
              if v_from_abs = v_target_abs then
                v_state := pg_catalog.jsonb_set(v_state, array['pieces', v_other_seat::text, v_other_piece::text], '-1'::jsonb, true);
                v_captures := v_captures || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('seat', v_other_seat, 'piece', v_other_piece));
              end if;
            end if;
          end loop;
        end if;
      end loop;
    end if;
  end if;

  if v_destination = 57 then
    v_all_home := true;
    for v_i in 0..3 loop
      if (v_state #>> array['pieces', v_member_seat::text, v_i::text])::integer <> 57 then v_all_home := false; end if;
    end loop;
    if v_all_home and not ((coalesce(v_state->'ranking', '[]'::jsonb)) @> pg_catalog.jsonb_build_array(v_member_seat)) then
      v_state := pg_catalog.jsonb_set(v_state, '{ranking}', coalesce(v_state->'ranking', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_member_seat), true);
    end if;
  end if;

  v_bonus := coalesce((v_state->>'bonus')::integer, 0);
  if pg_catalog.jsonb_array_length(v_captures) > 0 then v_bonus := v_bonus + 1; end if;
  if v_destination = 57 then v_bonus := v_bonus + 1; end if;
  v_state := pg_catalog.jsonb_set(v_state, '{bonus}', pg_catalog.to_jsonb(v_bonus), true);
  v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.jsonb_build_object(
    'type', 'move', 'seat', v_member_seat, 'piece', p_piece, 'die', v_die,
    'from', v_position, 'to', v_destination, 'captures', v_captures, 'finish', v_destination = 57
  ), true);

  if v_all_home then
    v_state := private.online_ludo_next_turn(v_state);
  elsif not private.online_ludo_has_move(v_state, v_member_seat) then
    v_state := private.online_ludo_finish_queue(v_state);
  else
    v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"move"'::jsonb, true);
  end if;

  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object('room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false, 'version', v_new_version, 'state', v_state);
  update public.match_states set version = v_new_version, state = v_state, updated_at = now() where room_id = p_room_id;
  if v_state->>'phase' = 'over' then
    v_winner_seat := (v_state->'ranking'->>0)::integer;
    select user_id into v_winner from public.room_members where room_id = p_room_id and seat = v_winner_seat;
    update public.rooms set status = 'completed', finished_at = now(), updated_at = now() where id = p_room_id;
    update public.match_history set status = 'completed', winner_id = v_winner,
      result = pg_catalog.jsonb_build_object('version', v_new_version, 'state', v_state), finished_at = now()
    where room_id = p_room_id and status = 'active';
  end if;
  insert into private.online_match_actions (room_id, action_id, actor_id, request, response)
  values (p_room_id, p_action_id, v_user, v_request, v_response);
  return v_response;
end;
$$;

revoke all on function public.move_match(uuid, bigint, uuid, integer, integer) from public, anon;
grant execute on function public.move_match(uuid, bigint, uuid, integer, integer) to authenticated;
