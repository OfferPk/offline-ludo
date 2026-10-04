-- FIDE Articles 9.2.1 and 9.3.1 allow a player to claim by declaring a legal
-- move that would create a third repetition or complete the 50-move threshold.
-- Keep the existing claim RPC unchanged for clients claiming the current state.
create or replace function public.claim_ludo_chess_draw_by_move(
  p_room_id uuid,
  p_expected_version bigint,
  p_action_id uuid,
  p_from integer,
  p_to integer,
  p_promotion text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_seat integer;
  v_status text;
  v_mode text;
  v_version bigint;
  v_state jsonb;
  v_candidate jsonb;
  v_existing private.online_match_actions%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_new_version bigint;
  v_result text;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0
     or p_action_id is null or p_from is null or p_to is null
     or p_from not between 0 and 63 or p_to not between 0 and 63 then
    raise exception 'Match action is invalid' using errcode = '22023';
  end if;

  select rm.seat into v_seat
  from public.room_members as rm
  where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;

  select r.status, r.mode into v_status, v_mode
  from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;

  select m.version, m.state into v_version, v_state
  from public.ludo_chess_matches as m where m.room_id = p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;

  v_request := pg_catalog.jsonb_build_object(
    'type', 'claim_draw_by_move', 'expected_version', p_expected_version,
    'from', p_from, 'to', p_to, 'promotion', p_promotion
  );
  select a.* into v_existing
  from private.online_match_actions as a
  where a.room_id = p_room_id and a.action_id = p_action_id;
  if found then
    if v_existing.actor_id <> v_user or v_existing.request <> v_request then
      raise exception 'Action ID was reused for a different request' using errcode = '23505';
    end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  if v_mode <> 'ludo_chess' or v_status <> 'active' or v_state->>'phase' <> 'active' then
    raise exception 'Chess game is not active' using errcode = '55000';
  end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  if (v_state->>'turn')::integer <> v_seat then raise exception 'Only the player to move can claim a draw' using errcode = '42501'; end if;

  -- Apply the proposed move only to a candidate snapshot. It is never played
  -- unless the player chooses the ordinary move action instead of claiming.
  v_candidate := private.ludo_chess_apply(v_state, p_from, p_to, p_promotion);
  if not private.ludo_chess_draw_claimable(v_candidate) then
    raise exception 'The intended move does not create a claimable draw' using errcode = '22023';
  end if;
  v_result := case when coalesce((v_candidate->>'halfmove')::integer, 0) >= 100
    then 'draw_fifty_move_claim' else 'draw_threefold_claim' end;

  v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{result}', pg_catalog.to_jsonb(v_result), true);
  v_state := pg_catalog.jsonb_set(v_state, '{winner}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{draw_claim}', pg_catalog.jsonb_build_object(
    'basis', v_result,
    'intended_move', pg_catalog.jsonb_build_object(
      'from', p_from, 'to', p_to,
      'promotion', case when p_promotion is null then null else pg_catalog.lower(p_promotion) end
    )
  ), true);

  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object(
    'room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false,
    'version', v_new_version, 'state', v_state
  );
  update public.ludo_chess_matches set version = v_new_version, state = v_state, updated_at = now()
    where room_id = p_room_id;
  update public.rooms set status = 'completed', finished_at = now(), updated_at = now()
    where id = p_room_id;
  update public.match_history set status = 'completed', winner_id = null,
    result = pg_catalog.jsonb_build_object('version', v_new_version, 'state', v_state),
    finished_at = now()
    where room_id = p_room_id and status = 'active';
  insert into private.online_match_actions (room_id, action_id, actor_id, request, response)
    values (p_room_id, p_action_id, v_user, v_request, v_response);
  return v_response;
end;
$$;

revoke all on function public.claim_ludo_chess_draw_by_move(uuid, bigint, uuid, integer, integer, text) from public, anon;
grant execute on function public.claim_ludo_chess_draw_by_move(uuid, bigint, uuid, integer, integer, text) to authenticated;
