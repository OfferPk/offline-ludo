-- Online Classic v1.4.0: lock the host's house rules at room creation, match
-- local logic.js (star stacking, safe squares, capture/home bonus, exact home,
-- 6 to leave base, arrows, blocks, capture-to-enter, no-capture), fix the
-- move_match v_all_home bug, and add a 45s turn timer plus a 20s reconnect
-- grace. Ludo Chess start_room behaviour is preserved. Mystery and Lucky stay
-- offline. No computer is substituted for a dropped player.

alter table public.rooms add column if not exists locked_rules jsonb;
alter table public.room_members add column if not exists disconnected_at timestamptz;

comment on column public.rooms.locked_rules is
  'House rules chosen by the host at create time. Never updated mid-match.';

drop function if exists public.create_room(text, integer);
drop function if exists public.quick_match(text, integer);

create or replace function private.online_ludo_rule(p_state jsonb, p_key text, p_default boolean)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_state #> array['rules', p_key] is null then p_default
    else coalesce((p_state #>> array['rules', p_key])::boolean, p_default)
  end;
$$;
revoke all on function private.online_ludo_rule(jsonb, text, boolean) from public, anon, authenticated;

create or replace function private.online_ludo_abs(p_seat integer, p_pos integer)
returns integer language sql immutable set search_path = '' as $$
  select case when p_pos between 0 and 51 then (p_pos + 13 * p_seat) % 52 else null end;
$$;
revoke all on function private.online_ludo_abs(integer, integer) from public, anon, authenticated;

create or replace function private.online_ludo_step(p_pos integer, p_enter boolean)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_pos < 0 or p_pos >= 57 then null
    when p_pos < 50 then p_pos + 1
    when p_pos = 50 then case when p_enter then 52 else 51 end
    when p_pos = 51 then 0
    else p_pos + 1
  end;
$$;
revoke all on function private.online_ludo_step(integer, boolean) from public, anon, authenticated;

create or replace function private.online_ludo_blocked(p_state jsonb, p_seat integer, p_pos integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_abs integer; v_other integer; v_piece integer; v_pos integer; v_count integer;
begin
  if not private.online_ludo_rule(p_state, 'blocks', false) then return false; end if;
  if p_pos is null or p_pos < 0 or p_pos > 51 then return false; end if;
  v_abs := private.online_ludo_abs(p_seat, p_pos);
  for v_other in 0..3 loop
    if v_other <> p_seat and p_state->'pieces'->v_other is not null and p_state->'pieces'->v_other <> 'null'::jsonb then
      v_count := 0;
      for v_piece in 0..3 loop
        v_pos := (p_state #>> array['pieces', v_other::text, v_piece::text])::integer;
        if v_pos between 0 and 51 and private.online_ludo_abs(v_other, v_pos) = v_abs then v_count := v_count + 1; end if;
      end loop;
      if v_count >= 2 then return true; end if;
    end if;
  end loop;
  return false;
end;
$$;
revoke all on function private.online_ludo_blocked(jsonb, integer, integer) from public, anon, authenticated;

-- Destination follows logic.js pathOf: 6 leaves base, exact home, capture-to-enter,
-- blocks, and a single arrow ride. Returns null when the die cannot be used.
create or replace function private.online_ludo_land(p_state jsonb, p_seat integer, p_piece integer, p_die integer)
returns integer language plpgsql immutable set search_path = '' as $$
declare
  v_pos integer; v_enter boolean; v_step integer; v_extra integer; v_abs integer; v_arrows boolean; v_capd boolean;
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
  for v_step in 1..p_die loop
    v_pos := private.online_ludo_step(v_pos, v_enter);
    if v_pos is null then return null; end if;
    if private.online_ludo_blocked(p_state, p_seat, v_pos) then return null; end if;
    if v_arrows and v_pos between 0 and 51 then
      v_abs := private.online_ludo_abs(p_seat, v_pos);
      if v_abs = any (array[4, 17, 30, 43]) then
        v_extra := private.online_ludo_step(v_pos, v_enter);
        if v_extra is not null and not private.online_ludo_blocked(p_state, p_seat, v_extra) then v_pos := v_extra; end if;
      end if;
    end if;
  end loop;
  return v_pos;
end;
$$;
revoke all on function private.online_ludo_land(jsonb, integer, integer, integer) from public, anon, authenticated;

create or replace function private.online_ludo_can_move(p_state jsonb, p_seat integer, p_piece integer, p_die integer)
returns boolean language sql immutable set search_path = '' as $$
  select private.online_ludo_land(p_state, p_seat, p_piece, p_die) is not null;
$$;
revoke all on function private.online_ludo_can_move(jsonb, integer, integer, integer) from public, anon, authenticated;

create or replace function private.online_ludo_next_turn(p_state jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_players jsonb := p_state->'players';
  v_ranking jsonb := coalesce(p_state->'ranking', '[]'::jsonb);
  v_abandoned jsonb := coalesce(p_state->'abandoned', '[]'::jsonb);
  v_player_count integer := pg_catalog.jsonb_array_length(p_state->'players');
  v_active_count integer := 0;
  v_current_index integer := -1;
  v_candidate_index integer;
  v_candidate integer;
  v_next integer;
  v_step integer;
  v_i integer;
  v_out jsonb;
begin
  for v_i in 0..v_player_count - 1 loop
    v_candidate := (v_players->>v_i)::integer;
    if not (v_ranking @> pg_catalog.jsonb_build_array(v_candidate))
       and not (v_abandoned @> pg_catalog.jsonb_build_array(v_candidate)) then
      v_active_count := v_active_count + 1;
    end if;
    if v_candidate = (p_state->>'turn')::integer then v_current_index := v_i; end if;
  end loop;

  if v_active_count <= 1 then
    for v_i in 0..v_player_count - 1 loop
      v_candidate := (v_players->>v_i)::integer;
      if not (v_ranking @> pg_catalog.jsonb_build_array(v_candidate))
         and not (v_abandoned @> pg_catalog.jsonb_build_array(v_candidate)) then
        v_ranking := v_ranking || pg_catalog.jsonb_build_array(v_candidate);
      end if;
    end loop;
    v_out := pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(p_state, '{ranking}', v_ranking, true),
          '{phase}', '"over"'::jsonb, true
        ),
        '{queue}', '[]'::jsonb, true
      ),
      '{bonus}', '0'::jsonb, true
    );
    if pg_catalog.jsonb_array_length(v_abandoned) > 0 then
      v_out := pg_catalog.jsonb_set(v_out, '{result}', '"abandoned"'::jsonb, true);
    end if;
    return pg_catalog.jsonb_set(v_out, '{turn_deadline}', 'null'::jsonb, true);
  end if;

  for v_step in 1..v_player_count loop
    v_candidate_index := (v_current_index + v_step) % v_player_count;
    v_candidate := (v_players->>v_candidate_index)::integer;
    if not (v_ranking @> pg_catalog.jsonb_build_array(v_candidate))
       and not (v_abandoned @> pg_catalog.jsonb_build_array(v_candidate)) then
      v_next := v_candidate;
      exit;
    end if;
  end loop;

  return pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(p_state, '{turn}', pg_catalog.to_jsonb(v_next), true),
            '{phase}', '"roll"'::jsonb, true
          ),
          '{queue}', '[]'::jsonb, true
        ),
        '{sixes}', '0'::jsonb, true
      ),
      '{bonus}', '0'::jsonb, true
    ),
    '{turn_count}', pg_catalog.to_jsonb(coalesce((p_state->>'turn_count')::integer, 0) + 1), true
  );
end;
$$;
revoke all on function private.online_ludo_next_turn(jsonb) from public, anon, authenticated;

create or replace function private.online_ludo_finish_queue(p_state jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_state jsonb := pg_catalog.jsonb_set(p_state, '{queue}', '[]'::jsonb, true);
  v_bonus integer := coalesce((p_state->>'bonus')::integer, 0);
begin
  if coalesce((p_state->>'roll_again')::boolean, false) then
    v_state := pg_catalog.jsonb_set(v_state, '{roll_again}', 'false'::jsonb, true);
    return pg_catalog.jsonb_set(v_state, '{phase}', '"roll"'::jsonb, true);
  end if;
  if v_bonus > 0 then
    v_state := pg_catalog.jsonb_set(v_state, '{bonus}', pg_catalog.to_jsonb(v_bonus - 1), true);
    v_state := pg_catalog.jsonb_set(v_state, '{sixes}', '0'::jsonb, true);
    return pg_catalog.jsonb_set(v_state, '{phase}', '"roll"'::jsonb, true);
  end if;
  return private.online_ludo_next_turn(v_state);
end;
$$;
revoke all on function private.online_ludo_finish_queue(jsonb) from public, anon, authenticated;

create or replace function private.online_ludo_arm_clock(p_state jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_phase text := p_state->>'phase';
  v_turn integer := coalesce((p_state->>'turn')::integer, 0);
  v_count integer := coalesce((p_state->>'turn_count')::integer, 0);
  v_deadline bigint;
begin
  if v_phase = 'over' or v_phase is null then
    return pg_catalog.jsonb_set(p_state, '{turn_deadline}', 'null'::jsonb, true);
  end if;
  if (p_state->>'armed_turn') is not null
     and (p_state->>'armed_turn')::integer = v_turn
     and coalesce((p_state->>'armed_count')::integer, -1) = v_count
     and coalesce((p_state->>'turn_deadline')::bigint, 0) > 0 then
    return p_state;
  end if;
  v_deadline := (pg_catalog.extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint + 45000;
  p_state := pg_catalog.jsonb_set(p_state, '{turn_deadline}', pg_catalog.to_jsonb(v_deadline), true);
  p_state := pg_catalog.jsonb_set(p_state, '{armed_turn}', pg_catalog.to_jsonb(v_turn), true);
  p_state := pg_catalog.jsonb_set(p_state, '{armed_count}', pg_catalog.to_jsonb(v_count), true);
  return p_state;
end;
$$;
revoke all on function private.online_ludo_arm_clock(jsonb) from public, anon, authenticated;

create or replace function private.online_ludo_normalize_rules(p_rules jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'rollStyle', case when p_rules->>'rollStyle' = 'classic' then 'classic' else 'star' end,
    'safeSquares', coalesce((p_rules->>'safeSquares')::boolean, true),
    'captureToEnter', coalesce((p_rules->>'captureToEnter')::boolean, false),
    'blocks', coalesce((p_rules->>'blocks')::boolean, false),
    'bonusOnCapture', coalesce((p_rules->>'bonusOnCapture')::boolean, true),
    'bonusOnHome', coalesce((p_rules->>'bonusOnHome')::boolean, true),
    'arrows', coalesce((p_rules->>'arrows')::boolean, false),
    'noCapture', coalesce((p_rules->>'noCapture')::boolean, false)
  );
$$;
revoke all on function private.online_ludo_normalize_rules(jsonb) from public, anon, authenticated;

create or replace function public.create_room(p_mode text, p_capacity integer default 2, p_rules jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_room_id uuid; v_code text; v_rules jsonb;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic','mystery','lucky','ludo_chess') then raise exception 'Unsupported game mode' using errcode = '22023'; end if;
  if p_capacity not in (2,3,4) or (p_mode = 'ludo_chess' and p_capacity <> 2) then raise exception 'Ludo Chess requires exactly two seats; other modes support 2, 3, or 4' using errcode = '22023'; end if;
  v_rules := case when p_mode = 'classic' then private.online_ludo_normalize_rules(coalesce(p_rules, '{}'::jsonb)) else null end;
  insert into public.rooms (created_by, mode, capacity, locked_rules) values (v_user, p_mode, p_capacity, v_rules) returning id into v_room_id;
  insert into public.room_members (room_id, user_id, seat, role, ready) values (v_room_id, v_user, 0, 'host', true);
  loop
    v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 16));
    exit when not exists (select 1 from public.room_invites where invite_code = v_code);
  end loop;
  insert into public.room_invites (room_id, inviter_id, invite_code) values (v_room_id, v_user, v_code);
  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', 'waiting', 'locked_rules', v_rules);
end;
$$;

create or replace function public.quick_match(p_mode text, p_capacity integer default 2, p_rules jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_room_id uuid; v_room public.rooms%rowtype; v_code text; v_seat integer; v_rules jsonb;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic','mystery','lucky','ludo_chess') then raise exception 'Unsupported game mode' using errcode = '22023'; end if;
  if p_capacity not in (2,3,4) or (p_mode = 'ludo_chess' and p_capacity <> 2) then raise exception 'Ludo Chess requires exactly two seats; other modes support 2, 3, or 4' using errcode = '22023'; end if;
  v_rules := case when p_mode = 'classic' then private.online_ludo_normalize_rules(coalesce(p_rules, '{}'::jsonb)) else null end;
  select r.id into v_room_id
  from public.rooms as r join public.room_members as own_member on own_member.room_id = r.id and own_member.user_id = v_user
  where r.status in ('waiting','active') and r.mode = p_mode and r.capacity = p_capacity
    and (p_mode <> 'classic' or r.locked_rules is not distinct from v_rules)
  order by r.created_at desc limit 1;
  if v_room_id is not null then
    select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
    return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', (select r.status from public.rooms as r where r.id = v_room_id), 'locked_rules', v_rules);
  end if;
  select r.id into v_room_id from public.rooms as r
  where r.status = 'waiting' and r.mode = p_mode and r.capacity = p_capacity
    and (p_mode <> 'classic' or r.locked_rules is not distinct from v_rules)
    and (select pg_catalog.count(*) from public.room_members as rm where rm.room_id = r.id) < r.capacity
  order by r.created_at limit 1 for update skip locked;
  if v_room_id is null then return public.create_room(p_mode, p_capacity, v_rules); end if;
  select r.* into v_room from public.rooms as r where r.id = v_room_id;
  select seats.seat_no into v_seat from pg_catalog.generate_series(0, v_room.capacity - 1) as seats(seat_no)
  where not exists (select 1 from public.room_members as rm where rm.room_id = v_room_id and rm.seat = seats.seat_no)
  order by seats.seat_no limit 1;
  insert into public.room_members (room_id, user_id, seat, role, ready) values (v_room_id, v_user, v_seat, 'player', false);
  update public.rooms set updated_at = now() where id = v_room_id;
  select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', v_room.status, 'locked_rules', v_room.locked_rules);
end;
$$;

create or replace function public.start_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_room public.rooms%rowtype; v_count integer; v_unready integer;
  v_players jsonb; v_pieces jsonb := '[]'::jsonb; v_state jsonb; v_seat integer;
  v_board text := 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
  v_position text; v_rules jsonb;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select r.* into v_room from public.rooms as r where r.id = p_room_id for update;
  if not found or v_room.status <> 'waiting' then raise exception 'Room is not waiting' using errcode = '55000'; end if;
  if v_room.created_by <> v_user then raise exception 'Only the room host can start the table' using errcode = '42501'; end if;
  select pg_catalog.count(*)::integer, pg_catalog.count(*) filter (where not ready)::integer into v_count, v_unready
  from public.room_members where room_id = p_room_id;
  if v_room.mode = 'ludo_chess' then
    if v_room.capacity <> 2 or v_count <> 2 then raise exception 'Ludo Chess requires exactly two players' using errcode = '22023'; end if;
    if v_unready > 0 then raise exception 'Every player must be ready' using errcode = '55000'; end if;
    v_state := pg_catalog.jsonb_build_object(
      'protocol',1,'mode','ludo_chess','board',v_board,'turn',0,'phase','active','castling','KQkq','en_passant',-1,
      'halfmove',0,'fullmove',1,'position_history','[]'::jsonb,'last_move',null,'winner',null,'result',null,'check',false
    );
    v_position := private.ludo_chess_position_key(v_state);
    v_state := pg_catalog.jsonb_set(v_state, '{position_history}', pg_catalog.jsonb_build_array(v_position), true);
    update public.rooms set status = 'active', started_at = now(), updated_at = now() where id = p_room_id;
    insert into public.match_history (room_id, mode, status) values (p_room_id, v_room.mode, 'active');
    insert into public.ludo_chess_matches (room_id, version, state) values (p_room_id, 0, v_state);
    return pg_catalog.jsonb_build_object('room_id',p_room_id,'status','active','started_at',now(),'version',0,'state',v_state);
  end if;
  if v_room.mode <> 'classic' then raise exception 'Online gameplay supports Classic and Ludo Chess; Mystery and Lucky remain available offline' using errcode = '22023'; end if;
  if v_count < 2 then raise exception 'At least two players are required' using errcode = '22023'; end if;
  if v_unready > 0 then raise exception 'Every player must be ready' using errcode = '55000'; end if;
  select pg_catalog.jsonb_agg(seat order by seat) into v_players from public.room_members where room_id = p_room_id;
  for v_seat in 0..3 loop
    if v_players @> pg_catalog.jsonb_build_array(v_seat) then v_pieces := v_pieces || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(-1,-1,-1,-1));
    else v_pieces := v_pieces || 'null'::jsonb; end if;
  end loop;
  v_rules := private.online_ludo_normalize_rules(coalesce(v_room.locked_rules, '{}'::jsonb));
  v_state := pg_catalog.jsonb_build_object(
    'protocol',1,'mode','classic','roll_style',v_rules->>'rollStyle',
    'rules',v_rules,
    'players',v_players,'pieces',v_pieces,'turn',(v_players->>0)::integer,'phase','roll','queue','[]'::jsonb,'sixes',0,'bonus',0,
    'ranking','[]'::jsonb,'abandoned','[]'::jsonb,'capd','[false,false,false,false]'::jsonb,'roll_again',false,
    'turn_count',0,'last_roll',null,'last_action',null,'grace',null
  );
  v_state := private.online_ludo_arm_clock(v_state);
  update public.rooms set status = 'active', started_at = now(), updated_at = now() where id = p_room_id;
  insert into public.match_history (room_id, mode, status) values (p_room_id, v_room.mode, 'active');
  insert into public.match_states (room_id, version, state) values (p_room_id, 0, v_state);
  return pg_catalog.jsonb_build_object('room_id',p_room_id,'status','active','started_at',now(),'version',0,'state',v_state);
end;
$$;

create or replace function public.roll_match(p_room_id uuid, p_expected_version bigint, p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_member_seat integer;
  v_version bigint;
  v_state jsonb;
  v_room_status text;
  v_face integer;
  v_sixes integer;
  v_request jsonb;
  v_existing private.online_match_actions%rowtype;
  v_response jsonb;
  v_new_version bigint;
  v_style text;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_action_id is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'Match action is invalid' using errcode = '22023';
  end if;
  select rm.seat into v_member_seat from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  select r.status into v_room_status from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select ms.version, ms.state into v_version, v_state from public.match_states as ms where ms.room_id = p_room_id for update;
  if not found then raise exception 'Authoritative match state is unavailable' using errcode = 'P0002'; end if;
  v_request := pg_catalog.jsonb_build_object('type', 'roll', 'expected_version', p_expected_version);
  select a.* into v_existing from private.online_match_actions as a where a.room_id = p_room_id and a.action_id = p_action_id;
  if found then
    if v_existing.actor_id <> v_user or v_existing.request <> v_request then raise exception 'Action ID was reused for a different request' using errcode = '23505'; end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate', true);
  end if;
  if v_room_status <> 'active' then raise exception 'Room is not active' using errcode = '55000'; end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  if v_state->>'phase' <> 'roll' then raise exception 'It is not the roll phase' using errcode = '55000'; end if;
  if (v_state->>'turn')::integer <> v_member_seat then raise exception 'It is not your turn' using errcode = '42501'; end if;
  if coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_member_seat) then raise exception 'This seat left the match' using errcode = '42501'; end if;
  if coalesce((v_state->>'turn_deadline')::bigint, 0) > 0
     and (pg_catalog.extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint > (v_state->>'turn_deadline')::bigint then
    raise exception 'Turn timer expired' using errcode = '55000';
  end if;

  v_face := private.online_ludo_die();
  v_sixes := coalesce((v_state->>'sixes')::integer, 0);
  v_style := coalesce(v_state #>> '{rules,rollStyle}', 'star');
  v_state := pg_catalog.jsonb_set(v_state, '{last_roll}', pg_catalog.jsonb_build_object('seat', v_member_seat, 'face', v_face), true);
  if v_face = 6 then v_sixes := v_sixes + 1; end if;

  if v_face = 6 and v_sixes >= 3 then
    v_state := pg_catalog.jsonb_set(v_state, '{sixes}', pg_catalog.to_jsonb(v_sixes), true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.jsonb_build_object('type', 'forfeit', 'seat', v_member_seat, 'face', v_face, 'lost', coalesce(v_state->'queue', '[]'::jsonb)), true);
    v_state := pg_catalog.jsonb_set(v_state, '{queue}', '[]'::jsonb, true);
    v_state := private.online_ludo_next_turn(v_state);
  else
    v_state := pg_catalog.jsonb_set(v_state, '{sixes}', pg_catalog.to_jsonb(v_sixes), true);
    v_state := pg_catalog.jsonb_set(v_state, '{queue}', coalesce(v_state->'queue', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_face), true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.jsonb_build_object('type', 'roll', 'seat', v_member_seat, 'face', v_face), true);
    if v_style = 'star' and v_face = 6 then
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"roll"'::jsonb, true);
    else
      if v_style <> 'star' then v_state := pg_catalog.jsonb_set(v_state, '{roll_again}', pg_catalog.to_jsonb(v_face = 6), true); end if;
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"move"'::jsonb, true);
      if not private.online_ludo_has_move(v_state, v_member_seat) then
        v_state := private.online_ludo_finish_queue(v_state);
      end if;
    end if;
  end if;

  v_state := private.online_ludo_arm_clock(v_state);
  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object('room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false, 'version', v_new_version, 'state', v_state);
  update public.match_states set version = v_new_version, state = v_state, updated_at = now() where room_id = p_room_id;
  insert into private.online_match_actions (room_id, action_id, actor_id, request, response)
  values (p_room_id, p_action_id, v_user, v_request, v_response);
  return v_response;
end;
$$;

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
     and (pg_catalog.extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint > (v_state->>'turn_deadline')::bigint then
    raise exception 'Turn timer expired' using errcode = '55000';
  end if;

  v_queue := coalesce(v_state->'queue', '[]'::jsonb);
  if p_queue_index >= pg_catalog.jsonb_array_length(v_queue) then raise exception 'Dice queue selection is invalid' using errcode = '22023'; end if;
  v_die := (v_queue->>p_queue_index)::integer;
  v_destination := private.online_ludo_land(v_state, v_member_seat, p_piece, v_die);
  if v_destination is null then raise exception 'That token cannot use the selected server die value' using errcode = '22023'; end if;
  v_position := (v_state #>> array['pieces', v_member_seat::text, p_piece::text])::integer;
  v_state := pg_catalog.jsonb_set(v_state, array['pieces', v_member_seat::text, p_piece::text], pg_catalog.to_jsonb(v_destination), true);
  v_queue := v_queue - p_queue_index;
  v_state := pg_catalog.jsonb_set(v_state, '{queue}', v_queue, true);

  v_safe := private.online_ludo_rule(v_state, 'safeSquares', true);
  v_nocap := private.online_ludo_rule(v_state, 'noCapture', false);
  if v_destination between 0 and 51 and not v_nocap then
    v_target_abs := private.online_ludo_abs(v_member_seat, v_destination);
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

create or replace function public.note_disconnect(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_seat integer; v_version bigint; v_state jsonb; v_until bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select rm.seat into v_seat from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  perform 1 from public.rooms as r where r.id = p_room_id and r.status = 'active' for update;
  if not found then raise exception 'Room is not active' using errcode = '55000'; end if;
  select ms.version, ms.state into v_version, v_state from public.match_states as ms where ms.room_id = p_room_id for update;
  if not found then raise exception 'Authoritative match state is unavailable' using errcode = 'P0002'; end if;
  update public.room_members set disconnected_at = now() where room_id = p_room_id and user_id = v_user;
  v_until := (pg_catalog.extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint + 20000;
  v_state := pg_catalog.jsonb_set(v_state, '{grace}', pg_catalog.jsonb_build_object('seat', v_seat, 'until', v_until), true);
  update public.match_states set version = v_version + 1, state = v_state, updated_at = now() where room_id = p_room_id;
  return pg_catalog.jsonb_build_object('room_id', p_room_id, 'seat', v_seat, 'grace_ms', 20000, 'version', v_version + 1, 'state', v_state);
end;
$$;

create or replace function public.rejoin_match(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_seat integer; v_gone timestamptz; v_version bigint; v_state jsonb;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select rm.seat, rm.disconnected_at into v_seat, v_gone from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  perform 1 from public.rooms as r where r.id = p_room_id for update;
  select ms.version, ms.state into v_version, v_state from public.match_states as ms where ms.room_id = p_room_id for update;
  if not found then return pg_catalog.jsonb_build_object('room_id', p_room_id, 'rejoined', true); end if;
  if coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_seat) then
    raise exception 'Reconnect window expired' using errcode = '55000';
  end if;
  if v_gone is not null and v_gone < now() - interval '20 seconds' then
    raise exception 'Reconnect window expired' using errcode = '55000';
  end if;
  update public.room_members set disconnected_at = null where room_id = p_room_id and user_id = v_user;
  if (v_state #>> '{grace,seat}') is not null and (v_state #>> '{grace,seat}')::integer = v_seat then
    v_state := pg_catalog.jsonb_set(v_state, '{grace}', 'null'::jsonb, true);
    update public.match_states set version = v_version + 1, state = v_state, updated_at = now() where room_id = p_room_id;
    v_version := v_version + 1;
  end if;
  return pg_catalog.jsonb_build_object('room_id', p_room_id, 'rejoined', true, 'seat', v_seat, 'version', v_version, 'state', v_state);
end;
$$;

create or replace function public.expire_grace(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_version bigint; v_state jsonb; v_seat integer; v_active integer := 0; v_players jsonb; v_i integer; v_candidate integer;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if not exists (select 1 from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user) then
    raise exception 'You are not a member of this room' using errcode = '42501';
  end if;
  perform 1 from public.rooms as r where r.id = p_room_id and r.status = 'active' for update;
  if not found then raise exception 'Room is not active' using errcode = '55000'; end if;
  select ms.version, ms.state into v_version, v_state from public.match_states as ms where ms.room_id = p_room_id for update;
  if not found then raise exception 'Authoritative match state is unavailable' using errcode = 'P0002'; end if;
  for v_seat in
    select rm.seat from public.room_members as rm
    where rm.room_id = p_room_id and rm.disconnected_at is not null and rm.disconnected_at < now() - interval '20 seconds'
  loop
    if not (coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array(v_seat)) then
      v_state := pg_catalog.jsonb_set(v_state, '{abandoned}', coalesce(v_state->'abandoned', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_seat), true);
    end if;
    if (v_state #>> '{grace,seat}') is not null and (v_state #>> '{grace,seat}')::integer = v_seat then
      v_state := pg_catalog.jsonb_set(v_state, '{grace}', 'null'::jsonb, true);
    end if;
    update public.room_members set disconnected_at = null where room_id = p_room_id and seat = v_seat;
  end loop;
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
    update public.rooms set status = 'completed', finished_at = now(), updated_at = now() where id = p_room_id;
    update public.match_history set status = 'completed', result = pg_catalog.jsonb_build_object('result', 'abandoned', 'state', v_state), finished_at = now()
    where room_id = p_room_id and status = 'active';
  elsif coalesce(v_state->'abandoned', '[]'::jsonb) @> pg_catalog.jsonb_build_array((v_state->>'turn')::integer) then
    v_state := private.online_ludo_next_turn(v_state);
    v_state := private.online_ludo_arm_clock(v_state);
  end if;
  update public.match_states set version = v_version + 1, state = v_state, updated_at = now() where room_id = p_room_id;
  return pg_catalog.jsonb_build_object('room_id', p_room_id, 'version', v_version + 1, 'state', v_state);
end;
$$;

create or replace function public.expire_turn(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_version bigint; v_state jsonb; v_deadline bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if not exists (select 1 from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user) then
    raise exception 'You are not a member of this room' using errcode = '42501';
  end if;
  perform 1 from public.rooms as r where r.id = p_room_id and r.status = 'active' for update;
  if not found then raise exception 'Room is not active' using errcode = '55000'; end if;
  select ms.version, ms.state into v_version, v_state from public.match_states as ms where ms.room_id = p_room_id for update;
  if not found then raise exception 'Authoritative match state is unavailable' using errcode = 'P0002'; end if;
  if v_state->>'phase' = 'over' then
    return pg_catalog.jsonb_build_object('room_id', p_room_id, 'expired', false, 'version', v_version, 'state', v_state);
  end if;
  v_deadline := coalesce((v_state->>'turn_deadline')::bigint, 0);
  if v_deadline <= 0 or (pg_catalog.extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint <= v_deadline then
    return pg_catalog.jsonb_build_object('room_id', p_room_id, 'expired', false, 'version', v_version, 'state', v_state);
  end if;
  v_state := private.online_ludo_next_turn(pg_catalog.jsonb_set(v_state, '{queue}', '[]'::jsonb, true));
  v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.jsonb_build_object('type', 'timeout'), true);
  v_state := private.online_ludo_arm_clock(v_state);
  update public.match_states set version = v_version + 1, state = v_state, updated_at = now() where room_id = p_room_id;
  if v_state->>'phase' = 'over' then
    update public.rooms set status = 'completed', finished_at = now(), updated_at = now() where id = p_room_id;
    update public.match_history set status = 'completed', result = pg_catalog.jsonb_build_object('state', v_state), finished_at = now()
    where room_id = p_room_id and status = 'active';
  end if;
  return pg_catalog.jsonb_build_object('room_id', p_room_id, 'expired', true, 'version', v_version + 1, 'state', v_state);
end;
$$;

revoke all on function public.create_room(text, integer, jsonb) from public, anon;
revoke all on function public.quick_match(text, integer, jsonb) from public, anon;
revoke all on function public.note_disconnect(uuid) from public, anon;
revoke all on function public.rejoin_match(uuid) from public, anon;
revoke all on function public.expire_grace(uuid) from public, anon;
revoke all on function public.expire_turn(uuid) from public, anon;
grant execute on function public.create_room(text, integer, jsonb) to authenticated;
grant execute on function public.quick_match(text, integer, jsonb) to authenticated;
grant execute on function public.note_disconnect(uuid) to authenticated;
grant execute on function public.rejoin_match(uuid) to authenticated;
grant execute on function public.expire_grace(uuid) to authenticated;
grant execute on function public.expire_turn(uuid) to authenticated;
