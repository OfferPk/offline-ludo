-- Server-authoritative Online Ludo Classic gameplay slice.
-- Mirrors the existing local engine's default Star-style rules: 6s stack,
-- three consecutive 6s forfeit the queue, safe squares, exact home entry,
-- captures and capture/home bonus rolls. Mystery/Lucky remain offline-only.

create table if not exists public.match_states (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  state jsonb not null check (pg_catalog.jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.match_states enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'match_states'
      and policyname = 'Room members can read authoritative match state'
  ) then
    execute $policy$
      create policy "Room members can read authoritative match state"
        on public.match_states for select to authenticated
        using (exists (
          select 1 from public.room_members as rm
          where rm.room_id = match_states.room_id
            and rm.user_id = (select auth.uid())
        ))
    $policy$;
  end if;
end;
$$;
revoke all on public.match_states from anon, authenticated;
grant select on public.match_states to authenticated;

create table if not exists private.online_match_actions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request jsonb not null check (pg_catalog.jsonb_typeof(request) = 'object'),
  response jsonb not null check (pg_catalog.jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (room_id, action_id)
);
alter table private.online_match_actions enable row level security;
revoke all on private.online_match_actions from public, anon, authenticated;

create or replace function private.online_ludo_die()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_number bigint;
begin
  -- Rejection sampling avoids modulo bias and keeps the die wholly server-side.
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_number := pg_catalog.get_byte(v_bytes, 0)::bigint * 16777216
      + pg_catalog.get_byte(v_bytes, 1)::bigint * 65536
      + pg_catalog.get_byte(v_bytes, 2)::bigint * 256
      + pg_catalog.get_byte(v_bytes, 3)::bigint;
    if v_number < 4294967292 then return (v_number % 6 + 1)::integer; end if;
  end loop;
end;
$$;
revoke all on function private.online_ludo_die() from public, anon, authenticated;

create or replace function private.online_ludo_destination(p_position integer, p_die integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_position integer := p_position;
  v_step integer;
begin
  if p_die not between 1 and 6 then return null; end if;
  if p_position = -1 then return case when p_die = 6 then 0 else null end; end if;
  if p_position < 0 or p_position >= 57 then return null; end if;
  for v_step in 1..p_die loop
    if v_position < 50 then
      v_position := v_position + 1;
    elsif v_position = 50 then
      -- DEFAULT_RULES.captureToEnter is false, so entry is allowed here.
      v_position := 52;
    elsif v_position = 51 then
      v_position := 0;
    elsif v_position < 57 then
      v_position := v_position + 1;
    else
      return null;
    end if;
  end loop;
  return v_position;
end;
$$;
revoke all on function private.online_ludo_destination(integer, integer) from public, anon, authenticated;

create or replace function private.online_ludo_can_move(p_state jsonb, p_seat integer, p_piece integer, p_die integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_piece between 0 and 3
    and p_seat between 0 and 3
    and pg_catalog.jsonb_typeof(p_state #> array['pieces', p_seat::text, p_piece::text]) = 'number'
    and private.online_ludo_destination(
      (p_state #>> array['pieces', p_seat::text, p_piece::text])::integer,
      p_die
    ) is not null;
$$;
revoke all on function private.online_ludo_can_move(jsonb, integer, integer, integer) from public, anon, authenticated;

create or replace function private.online_ludo_has_move(p_state jsonb, p_seat integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_die integer;
  v_piece integer;
begin
  for v_die in select value::integer from pg_catalog.jsonb_array_elements_text(coalesce(p_state->'queue', '[]'::jsonb)) as q(value) loop
    for v_piece in 0..3 loop
      if private.online_ludo_can_move(p_state, p_seat, v_piece, v_die) then return true; end if;
    end loop;
  end loop;
  return false;
end;
$$;
revoke all on function private.online_ludo_has_move(jsonb, integer) from public, anon, authenticated;

create or replace function private.online_ludo_next_turn(p_state jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_players jsonb := p_state->'players';
  v_ranking jsonb := coalesce(p_state->'ranking', '[]'::jsonb);
  v_player_count integer := pg_catalog.jsonb_array_length(p_state->'players');
  v_active_count integer := 0;
  v_current_index integer := -1;
  v_candidate_index integer;
  v_candidate integer;
  v_next integer;
  v_step integer;
  v_i integer;
begin
  for v_i in 0..v_player_count - 1 loop
    v_candidate := (v_players->>v_i)::integer;
    if not (v_ranking @> pg_catalog.jsonb_build_array(v_candidate)) then
      v_active_count := v_active_count + 1;
    end if;
    if v_candidate = (p_state->>'turn')::integer then v_current_index := v_i; end if;
  end loop;

  if v_active_count <= 1 then
    for v_i in 0..v_player_count - 1 loop
      v_candidate := (v_players->>v_i)::integer;
      if not (v_ranking @> pg_catalog.jsonb_build_array(v_candidate)) then
        v_ranking := v_ranking || pg_catalog.jsonb_build_array(v_candidate);
      end if;
    end loop;
    return pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(p_state, '{ranking}', v_ranking, true),
          '{phase}', '"over"'::jsonb, true
        ),
        '{queue}', '[]'::jsonb, true
      ),
      '{bonus}', '0'::jsonb, true
    );
  end if;

  for v_step in 1..v_player_count loop
    v_candidate_index := (v_current_index + v_step) % v_player_count;
    v_candidate := (v_players->>v_candidate_index)::integer;
    if not (v_ranking @> pg_catalog.jsonb_build_array(v_candidate)) then
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
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state jsonb := pg_catalog.jsonb_set(p_state, '{queue}', '[]'::jsonb, true);
  v_bonus integer := coalesce((p_state->>'bonus')::integer, 0);
begin
  if v_bonus > 0 then
    v_state := pg_catalog.jsonb_set(v_state, '{bonus}', pg_catalog.to_jsonb(v_bonus - 1), true);
    v_state := pg_catalog.jsonb_set(v_state, '{sixes}', '0'::jsonb, true);
    return pg_catalog.jsonb_set(v_state, '{phase}', '"roll"'::jsonb, true);
  end if;
  return private.online_ludo_next_turn(v_state);
end;
$$;
revoke all on function private.online_ludo_finish_queue(jsonb) from public, anon, authenticated;

create or replace function public.start_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_count integer;
  v_unready integer;
  v_players jsonb;
  v_pieces jsonb := '[]'::jsonb;
  v_state jsonb;
  v_seat integer;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select r.* into v_room from public.rooms as r where r.id = p_room_id for update;
  if not found or v_room.status <> 'waiting' then raise exception 'Room is not waiting' using errcode = '55000'; end if;
  if v_room.created_by <> v_user then raise exception 'Only the room host can start the table' using errcode = '42501'; end if;
  if v_room.mode <> 'classic' then raise exception 'Online gameplay currently supports Classic rooms only; Mystery and Lucky remain available offline' using errcode = '22023'; end if;
  select pg_catalog.count(*)::integer, pg_catalog.count(*) filter (where not ready)::integer
    into v_count, v_unready
  from public.room_members where room_id = p_room_id;
  if v_count < 2 then raise exception 'At least two players are required' using errcode = '22023'; end if;
  if v_unready > 0 then raise exception 'Every player must be ready' using errcode = '55000'; end if;

  select pg_catalog.jsonb_agg(seat order by seat) into v_players
  from public.room_members where room_id = p_room_id;
  for v_seat in 0..3 loop
    if v_players @> pg_catalog.jsonb_build_array(v_seat) then
      v_pieces := v_pieces || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(-1, -1, -1, -1));
    else
      v_pieces := v_pieces || 'null'::jsonb;
    end if;
  end loop;
  v_state := pg_catalog.jsonb_build_object(
    'protocol', 1,
    'mode', 'classic',
    'roll_style', 'star',
    'rules', pg_catalog.jsonb_build_object(
      'rollStyle', 'star', 'safeSquares', true, 'captureToEnter', false,
      'blocks', false, 'bonusOnCapture', true, 'bonusOnHome', true
    ),
    'players', v_players,
    'pieces', v_pieces,
    'turn', (v_players->>0)::integer,
    'phase', 'roll',
    'queue', '[]'::jsonb,
    'sixes', 0,
    'bonus', 0,
    'ranking', '[]'::jsonb,
    'turn_count', 0,
    'last_roll', null,
    'last_action', null
  );

  update public.rooms set status = 'active', started_at = now(), updated_at = now() where id = p_room_id;
  insert into public.match_history (room_id, mode, status)
  values (p_room_id, v_room.mode, 'active');
  insert into public.match_states (room_id, version, state) values (p_room_id, 0, v_state);
  return pg_catalog.jsonb_build_object('room_id', p_room_id, 'status', 'active', 'started_at', now(), 'version', 0, 'state', v_state);
end;
$$;

create or replace function public.roll_match(p_room_id uuid, p_expected_version bigint, p_action_id uuid)
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
  v_face integer;
  v_sixes integer;
  v_request jsonb;
  v_existing private.online_match_actions%rowtype;
  v_response jsonb;
  v_new_version bigint;
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

  v_face := private.online_ludo_die();
  v_sixes := coalesce((v_state->>'sixes')::integer, 0);
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
    if v_face = 6 then
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"roll"'::jsonb, true);
    else
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"move"'::jsonb, true);
      if not private.online_ludo_has_move(v_state, v_member_seat) then
        v_state := private.online_ludo_finish_queue(v_state);
      end if;
    end if;
  end if;

  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object('room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false, 'version', v_new_version, 'state', v_state);
  update public.match_states set version = v_new_version, state = v_state, updated_at = now() where room_id = p_room_id;
  insert into private.online_match_actions (room_id, action_id, actor_id, request, response)
  values (p_room_id, p_action_id, v_user, v_request, v_response);
  return v_response;
end;
$$;

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

revoke all on function public.roll_match(uuid, bigint, uuid) from public, anon;
revoke all on function public.move_match(uuid, bigint, uuid, integer, integer) from public, anon;
grant execute on function public.roll_match(uuid, bigint, uuid) to authenticated;
grant execute on function public.move_match(uuid, bigint, uuid, integer, integer) to authenticated;

-- Realtime carries state-row updates only to authenticated room members whose
-- SELECT policy permits the row. Clients still fetch on reconnect to avoid gaps.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_states'
     ) then
    alter publication supabase_realtime add table public.match_states;
  end if;
end;
$$;
