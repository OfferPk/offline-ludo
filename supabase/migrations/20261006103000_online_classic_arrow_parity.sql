-- Bring server-authoritative Online Classic arrow rules into parity with
-- www/js/logic.js: arrows trigger only on an exact landing, then jump +4 once;
-- captures apply along that jump path. This migration is intentionally additive
-- and remains unapplied until the separately approved production migration flow.

create or replace function private.online_ludo_land(p_state jsonb, p_seat integer, p_piece integer, p_die integer)
returns integer language plpgsql immutable set search_path = '' as $$
declare
  v_pos integer; v_enter boolean; v_step integer; v_extra integer; v_abs integer; v_arrows boolean; v_capd boolean; v_jump integer;
begin
  if p_die not between 1 and 6 or p_piece not between 0 and 3 or p_seat not between 0 and 3 then return null; end if;
  if pg_catalog.jsonb_typeof(p_state #> array['pieces', p_seat::text, p_piece::text]) <> 'number' then return null; end if;
  v_pos := (p_state #>> array['pieces', p_seat::text, p_piece::text])::integer;
  if v_pos = 57 or v_pos is null then return null; end if;
  if v_pos < 0 then
    if p_die = 6 then return 0; end if;
    return null;
  end if;
  v_capd := coalesce((p_state #>> array['capd', p_seat::text])::boolean, false);
  v_enter := not private.online_ludo_rule(p_state, 'captureToEnter', false) or v_capd;
  v_arrows := private.online_ludo_rule(p_state, 'arrows', false);

  -- First resolve the ordinary die path. An arrow only activates when the roll
  -- ends on it; merely crossing one during the die movement does not jump.
  for v_step in 1..p_die loop
    v_pos := private.online_ludo_step(v_pos, v_enter);
    if v_pos is null then return null; end if;
    if private.online_ludo_blocked(p_state, p_seat, v_pos) then return null; end if;
  end loop;

  if v_arrows and v_pos between 0 and 51 then
    v_abs := private.online_ludo_abs(p_seat, v_pos);
    if v_abs = any (array[4, 17, 30, 43]) then
      v_jump := v_pos;
      -- A successful arrow jump advances exactly four squares. If any square
      -- is blocked, the move remains on the arrow rather than becoming illegal.
      for v_step in 1..4 loop
        v_extra := private.online_ludo_step(v_jump, v_enter);
        if v_extra is null or private.online_ludo_blocked(p_state, p_seat, v_extra) then
          return v_pos;
        end if;
        v_jump := v_extra;
      end loop;
      return v_jump;
    end if;
  end if;
  return v_pos;
end;
$$;
revoke all on function private.online_ludo_land(jsonb, integer, integer, integer) from public, anon, authenticated;

create or replace function public.move_match(p_room_id uuid, p_expected_version bigint, p_action_id uuid, p_piece integer, p_queue_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  v_land integer;
  v_enter boolean;
  v_step integer;
  v_capture_position integer;
  v_capture_positions integer[] := array[]::integer[];
  v_target_abs integer;
  v_other_seat integer;
  v_other_piece integer;
  v_other_position integer;
  v_captures jsonb := '[]'::jsonb;
  v_bonus integer;
  v_all_home boolean := false;
  v_i integer;
  v_winner_seat integer;
  v_winner uuid;
  v_safe boolean;
  v_nocap boolean;
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
  if coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_member_seat) then raise exception 'This seat left the match' using errcode = '42501'; end if;
  if coalesce((v_state->>'turn_deadline')::bigint, 0) > 0
     and (extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint > (v_state->>'turn_deadline')::bigint then
    raise exception 'Turn timer expired' using errcode = '55000';
  end if;

  v_queue := coalesce(v_state->'queue', '[]'::jsonb);
  if p_queue_index >= pg_catalog.jsonb_array_length(v_queue) then raise exception 'Dice queue selection is invalid' using errcode = '22023'; end if;
  v_die := (v_queue->>p_queue_index)::integer;
  v_position := (v_state #>> array['pieces', v_member_seat::text, p_piece::text])::integer;
  v_destination := private.online_ludo_land(v_state, v_member_seat, p_piece, v_die);
  if v_destination is null then raise exception 'That token cannot use the selected server die value' using errcode = '22023'; end if;

  -- Reconstruct the ordinary die landing so captures can cover the arrow square
  -- and every square in a successful +4 jump, not just the final destination.
  v_enter := not private.online_ludo_rule(v_state, 'captureToEnter', false)
    or coalesce((v_state #>> array['capd', v_member_seat::text])::boolean, false);
  if v_position >= 0 then
    v_land := v_position;
    for v_step in 1..v_die loop
      v_land := private.online_ludo_step(v_land, v_enter);
    end loop;
  else
    v_land := null;
  end if;
  if v_land between 0 and 51
     and v_destination <> v_land
     and private.online_ludo_rule(v_state, 'arrows', false)
     and private.online_ludo_abs(v_member_seat, v_land) = any (array[4, 17, 30, 43]) then
    v_capture_positions := array_append(v_capture_positions, v_land);
    v_capture_position := v_land;
    for v_step in 1..4 loop
      v_capture_position := private.online_ludo_step(v_capture_position, v_enter);
      v_capture_positions := array_append(v_capture_positions, v_capture_position);
    end loop;
    if v_capture_position is distinct from v_destination then
      raise exception 'Arrow destination is inconsistent' using errcode = 'XX000';
    end if;
  else
    v_capture_positions := array[v_destination];
  end if;

  v_state := pg_catalog.jsonb_set(v_state, array['pieces', v_member_seat::text, p_piece::text], pg_catalog.to_jsonb(v_destination), true);
  v_queue := v_queue - p_queue_index;
  v_state := pg_catalog.jsonb_set(v_state, '{queue}', v_queue, true);

  v_safe := private.online_ludo_rule(v_state, 'safeSquares', true);
  v_nocap := private.online_ludo_rule(v_state, 'noCapture', false);
  if not v_nocap then
    foreach v_capture_position in array v_capture_positions loop
      if v_capture_position between 0 and 51 then
        v_target_abs := private.online_ludo_abs(v_member_seat, v_capture_position);
        if not (v_safe and v_target_abs = any (array[0, 8, 13, 21, 26, 34, 39, 47])) then
          for v_other_seat in 0..3 loop
            if v_other_seat <> v_member_seat and v_state->'pieces'->v_other_seat is not null and v_state->'pieces'->v_other_seat <> 'null'::jsonb then
              for v_other_piece in 0..3 loop
                v_other_position := (v_state #>> array['pieces', v_other_seat::text, v_other_piece::text])::integer;
                if v_other_position between 0 and 51 and private.online_ludo_abs(v_other_seat, v_other_position) = v_target_abs then
                  v_state := pg_catalog.jsonb_set(v_state, array['pieces', v_other_seat::text, v_other_piece::text], '-1'::jsonb, true);
                  v_captures := v_captures || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('seat', v_other_seat, 'piece', v_other_piece));
                end if;
              end loop;
            end if;
          end loop;
        end if;
      end if;
    end loop;
  end if;

  if pg_catalog.jsonb_array_length(v_captures) > 0 then
    if v_state->'capd' is null or pg_catalog.jsonb_typeof(v_state->'capd') <> 'array' then
      v_state := pg_catalog.jsonb_set(v_state, '{capd}', '[false, false, false, false]'::jsonb, true);
    end if;
    v_state := pg_catalog.jsonb_set(v_state, array['capd', v_member_seat::text], 'true'::jsonb, true);
  end if;

  -- v_all_home starts false. Only a move that lands on home, with every token of
  -- this seat already home, may take the finished-player branch. A non-home move
  -- must go through has_move / finish_queue (the previous function left the flag
  -- true and skipped the turn).
  if v_destination = 57 then
    v_all_home := true;
    for v_i in 0..3 loop
      if (v_state #>> array['pieces', v_member_seat::text, v_i::text])::integer <> 57 then v_all_home := false; end if;
    end loop;
    if v_all_home and not (coalesce(v_state->'ranking', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_member_seat)) then
      v_state := pg_catalog.jsonb_set(v_state, '{ranking}', coalesce(v_state->'ranking', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_member_seat), true);
    end if;
  end if;

  v_bonus := coalesce((v_state->>'bonus')::integer, 0);
  if pg_catalog.jsonb_array_length(v_captures) > 0 and private.online_ludo_rule(v_state, 'bonusOnCapture', true) then v_bonus := v_bonus + 1; end if;
  if v_destination = 57 and private.online_ludo_rule(v_state, 'bonusOnHome', true) then v_bonus := v_bonus + 1; end if;
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

  v_state := private.online_ludo_arm_clock(v_state);
  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object('room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false, 'version', v_new_version, 'state', v_state);
  update public.match_states set version = v_new_version, state = v_state, updated_at = now() where room_id = p_room_id;
  if v_state->>'phase' = 'over' then
    v_winner_seat := nullif(v_state->'ranking'->>0, '')::integer;
    if v_winner_seat is not null then
      select user_id into v_winner from public.room_members where room_id = p_room_id and seat = v_winner_seat;
    end if;
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
