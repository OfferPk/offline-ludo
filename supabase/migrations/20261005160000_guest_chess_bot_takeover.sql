-- Optional server-backed guest Chess. This migration is additive and is NOT applied
-- automatically by the client. Auth anonymous sign-in must remain disabled until
-- the documented rollout checks and configuration are explicitly completed.

create table if not exists public.ludo_chess_bot_seats (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  seat smallint not null check (seat = 1),
  bot_kind text not null default 'random_legal' check (bot_kind = 'random_legal'),
  created_at timestamptz not null default now(),
  unique (room_id, seat)
);

alter table public.ludo_chess_bot_seats enable row level security;
drop policy if exists "Room members can read the Chess computer seat" on public.ludo_chess_bot_seats;
create policy "Room members can read the Chess computer seat"
  on public.ludo_chess_bot_seats for select to authenticated
  using ((select private.is_room_member(room_id)));
revoke all on public.ludo_chess_bot_seats from public, anon, authenticated;
grant select on public.ludo_chess_bot_seats to authenticated;

create index if not exists ludo_chess_bot_seats_room_idx
  on public.ludo_chess_bot_seats (room_id, seat);

create table if not exists private.guest_chess_room_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (actor_id, action_id)
);
alter table private.guest_chess_room_requests enable row level security;
revoke all on private.guest_chess_room_requests from public, anon, authenticated;

-- The bot has no Auth identity, room_members row, profile, wallet, or client-callable
-- action. Legal moves are selected and applied only inside the room-locked move RPC.
create or replace function private.ludo_chess_random_legal_move(p_state jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_board text := p_state->>'board';
  v_color integer := (p_state->>'turn')::integer;
  v_piece text;
  v_type text;
  v_from integer;
  v_to integer;
  v_dr integer;
  v_dc integer;
  v_geometry boolean;
  v_promotion text;
  v_promo text;
  v_total integer := 0;
  v_seen integer := 0;
  v_pick integer;
  v_bytes bytea;
  v_random bigint;
  v_limit bigint;
begin
  if p_state->>'phase' <> 'active' or v_color not between 0 and 1
     or v_board is null or pg_catalog.char_length(v_board) <> 64 then
    raise exception 'The computer cannot move in this position' using errcode = '55000';
  end if;

  -- Count legal candidates first, then choose one using server-side random bytes.
  for v_from in 0..63 loop
    v_piece := pg_catalog.substr(v_board, v_from + 1, 1);
    if private.ludo_chess_color(v_piece) is distinct from v_color then continue; end if;
    v_type := pg_catalog.lower(v_piece);
    for v_to in 0..63 loop
      if v_to = v_from then continue; end if;
      v_dr := (v_to / 8) - (v_from / 8);
      v_dc := (v_to % 8) - (v_from % 8);
      v_geometry := case
        when v_type = 'p' then (v_dc = 0 and pg_catalog.abs(v_dr) in (1, 2)) or (pg_catalog.abs(v_dc) = 1 and pg_catalog.abs(v_dr) = 1)
        when v_type = 'n' then (pg_catalog.abs(v_dr) = 2 and pg_catalog.abs(v_dc) = 1) or (pg_catalog.abs(v_dr) = 1 and pg_catalog.abs(v_dc) = 2)
        when v_type = 'k' then greatest(pg_catalog.abs(v_dr), pg_catalog.abs(v_dc)) = 1 or (v_dr = 0 and pg_catalog.abs(v_dc) = 2)
        when v_type = 'b' then pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0
        when v_type = 'r' then (v_dr = 0) <> (v_dc = 0)
        when v_type = 'q' then ((v_dr = 0) <> (v_dc = 0)) or (pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0)
        else false
      end;
      if not v_geometry then continue; end if;
      if v_type = 'p' and (v_to / 8) in (0, 7) then
        foreach v_promo in array array['q', 'r', 'b', 'n']::text[] loop
          if private.ludo_chess_legal(p_state, v_from, v_to, v_promo) then v_total := v_total + 1; end if;
        end loop;
      elsif private.ludo_chess_legal(p_state, v_from, v_to, null) then
        v_total := v_total + 1;
      end if;
    end loop;
  end loop;
  if v_total = 0 then raise exception 'The computer has no legal move' using errcode = '55000'; end if;

  -- Rejection sampling avoids modulo bias and never accepts client-provided bot moves.
  v_limit := (4294967296::bigint / v_total) * v_total;
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_random := pg_catalog.get_byte(v_bytes, 0)::bigint * 16777216
      + pg_catalog.get_byte(v_bytes, 1)::bigint * 65536
      + pg_catalog.get_byte(v_bytes, 2)::bigint * 256
      + pg_catalog.get_byte(v_bytes, 3)::bigint;
    exit when v_random < v_limit;
  end loop;
  v_pick := (v_random % v_total)::integer;

  for v_from in 0..63 loop
    v_piece := pg_catalog.substr(v_board, v_from + 1, 1);
    if private.ludo_chess_color(v_piece) is distinct from v_color then continue; end if;
    v_type := pg_catalog.lower(v_piece);
    for v_to in 0..63 loop
      if v_to = v_from then continue; end if;
      v_dr := (v_to / 8) - (v_from / 8);
      v_dc := (v_to % 8) - (v_from % 8);
      v_geometry := case
        when v_type = 'p' then (v_dc = 0 and pg_catalog.abs(v_dr) in (1, 2)) or (pg_catalog.abs(v_dc) = 1 and pg_catalog.abs(v_dr) = 1)
        when v_type = 'n' then (pg_catalog.abs(v_dr) = 2 and pg_catalog.abs(v_dc) = 1) or (pg_catalog.abs(v_dr) = 1 and pg_catalog.abs(v_dc) = 2)
        when v_type = 'k' then greatest(pg_catalog.abs(v_dr), pg_catalog.abs(v_dc)) = 1 or (v_dr = 0 and pg_catalog.abs(v_dc) = 2)
        when v_type = 'b' then pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0
        when v_type = 'r' then (v_dr = 0) <> (v_dc = 0)
        when v_type = 'q' then ((v_dr = 0) <> (v_dc = 0)) or (pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0)
        else false
      end;
      if not v_geometry then continue; end if;
      if v_type = 'p' and (v_to / 8) in (0, 7) then
        foreach v_promo in array array['q', 'r', 'b', 'n']::text[] loop
          if private.ludo_chess_legal(p_state, v_from, v_to, v_promo) then
            if v_seen = v_pick then return pg_catalog.jsonb_build_object('from', v_from, 'to', v_to, 'promotion', v_promo); end if;
            v_seen := v_seen + 1;
          end if;
        end loop;
      elsif private.ludo_chess_legal(p_state, v_from, v_to, null) then
        if v_seen = v_pick then return pg_catalog.jsonb_build_object('from', v_from, 'to', v_to, 'promotion', null); end if;
        v_seen := v_seen + 1;
      end if;
    end loop;
  end loop;
  raise exception 'The computer move could not be selected' using errcode = '55000';
end;
$$;
revoke all on function private.ludo_chess_random_legal_move(jsonb) from public, anon, authenticated;

-- A single anonymous Auth identity can create/resume one active server Chess room.
-- A repeated action ID returns its original room; no guest profile/wallet is provisioned.
create or replace function public.create_guest_ludo_chess_room(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
  v_existing private.guest_chess_room_requests%rowtype;
  v_status text;
  v_version bigint;
  v_state jsonb;
  v_board text := 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
  v_initial jsonb;
  v_response jsonb;
  v_position text;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_action_id is null then raise exception 'Action ID is required' using errcode = '22023'; end if;
  if not private.is_current_user_anonymous() then raise exception 'This room creator must use an anonymous guest session' using errcode = '42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user::text), 0);
  select q.* into v_existing from private.guest_chess_room_requests as q
    where q.actor_id = v_user and q.action_id = p_action_id;
  if found then
    select r.status, m.version, m.state into v_status, v_version, v_state
      from public.rooms as r join public.ludo_chess_matches as m on m.room_id = r.id
      where r.id = v_existing.room_id;
    return pg_catalog.jsonb_build_object('room_id', v_existing.room_id, 'status', v_status, 'version', v_version, 'state', v_state, 'duplicate', true);
  end if;

  select r.id, m.version, m.state into v_room_id, v_version, v_state
    from public.room_members as rm
    join public.rooms as r on r.id = rm.room_id
    join public.ludo_chess_matches as m on m.room_id = r.id
    where rm.user_id = v_user and r.mode = 'ludo_chess' and r.status = 'active'
    order by r.updated_at desc
    limit 1
    for update of r;
  if v_room_id is not null then
    v_response := pg_catalog.jsonb_build_object('room_id', v_room_id, 'status', 'active', 'version', v_version, 'state', v_state, 'duplicate', true);
    insert into private.guest_chess_room_requests (actor_id, action_id, room_id) values (v_user, p_action_id, v_room_id);
    return v_response;
  end if;

  v_initial := pg_catalog.jsonb_build_object(
    'protocol',1,'mode','ludo_chess','board',v_board,'turn',0,'phase','active','castling','KQkq','en_passant',-1,
    'halfmove',0,'fullmove',1,'position_history','[]'::jsonb,'last_move',null,'winner',null,'result',null,'check',false
  );
  v_position := private.ludo_chess_position_key(v_initial);
  v_initial := pg_catalog.jsonb_set(v_initial, '{position_history}', pg_catalog.jsonb_build_array(v_position), true);

  insert into public.rooms (created_by, mode, capacity, status, started_at)
    values (v_user, 'ludo_chess', 2, 'active', now()) returning id into v_room_id;
  insert into public.room_members (room_id, user_id, seat, role, ready)
    values (v_room_id, v_user, 0, 'host', true);
  insert into public.ludo_chess_bot_seats (room_id, seat, bot_kind)
    values (v_room_id, 1, 'random_legal');
  insert into public.match_history (room_id, mode, status)
    values (v_room_id, 'ludo_chess', 'active');
  insert into public.ludo_chess_matches (room_id, version, state)
    values (v_room_id, 0, v_initial);
  insert into private.guest_chess_room_requests (actor_id, action_id, room_id)
    values (v_user, p_action_id, v_room_id);

  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'status', 'active', 'version', 0, 'state', v_initial, 'duplicate', false);
end;
$$;

-- Reveals only a candidate room ID and version. The caller must still win the
-- version-checked, serialized takeover RPC; no roster or board state is public.
create or replace function public.find_ludo_chess_bot_room()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
  v_version bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select r.id, m.version into v_room_id, v_version
    from public.ludo_chess_bot_seats as b
    join public.rooms as r on r.id = b.room_id
    join public.ludo_chess_matches as m on m.room_id = r.id
    where r.mode = 'ludo_chess' and r.status = 'active' and m.state->>'phase' = 'active'
      and not exists (select 1 from public.room_members as own where own.room_id = r.id and own.user_id = v_user)
    order by r.created_at asc
    limit 1;
  if v_room_id is null then return pg_catalog.jsonb_build_object('room_id', null, 'version', null); end if;
  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'version', v_version);
end;
$$;

-- All callers serialize on rooms then match state (the same lock order as move RPCs).
-- The unique room/seat key is an additional concurrency backstop. Takeover changes
-- ownership metadata/version only; it never rewrites a move or a bot identity.
create or replace function public.takeover_ludo_chess_bot_room(
  p_room_id uuid,
  p_expected_version bigint,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_version bigint;
  v_state jsonb;
  v_bot_seat integer;
  v_existing private.online_match_actions%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_new_version bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0 or p_action_id is null then
    raise exception 'Match action is invalid' using errcode = '22023';
  end if;

  select r.* into v_room from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select m.version, m.state into v_version, v_state
    from public.ludo_chess_matches as m where m.room_id = p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;

  v_request := pg_catalog.jsonb_build_object('type', 'chess_bot_takeover', 'expected_version', p_expected_version);
  select a.* into v_existing from private.online_match_actions as a
    where a.room_id = p_room_id and a.action_id = p_action_id;
  if found then
    if v_existing.actor_id <> v_user or v_existing.request <> v_request then
      raise exception 'Action ID was reused for a different request' using errcode = '23505';
    end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  if v_room.mode <> 'ludo_chess' or v_room.status <> 'active' or v_state->>'phase' <> 'active' then
    raise exception 'Chess room is not active' using errcode = '55000';
  end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  if exists (select 1 from public.room_members as own where own.room_id = p_room_id and own.user_id = v_user) then
    raise exception 'You are already a member of this room' using errcode = '42501';
  end if;
  select b.seat into v_bot_seat from public.ludo_chess_bot_seats as b where b.room_id = p_room_id for update;
  if not found then raise exception 'The computer seat has already been taken' using errcode = '55000'; end if;

  delete from public.ludo_chess_bot_seats where room_id = p_room_id and seat = v_bot_seat;
  if not found then raise exception 'The computer seat has already been taken' using errcode = '40001'; end if;
  insert into public.room_members (room_id, user_id, seat, role, ready)
    values (p_room_id, v_user, v_bot_seat, 'player', true);

  v_new_version := v_version + 1;
  update public.ludo_chess_matches
    set version = v_new_version, draw_offer = null, updated_at = now()
    where room_id = p_room_id;
  update public.rooms set updated_at = now() where id = p_room_id;
  v_response := pg_catalog.jsonb_build_object(
    'room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false,
    'seat', v_bot_seat, 'bot_seat', null, 'version', v_new_version, 'state', v_state
  );
  insert into private.online_match_actions (room_id, action_id, actor_id, request, response)
    values (p_room_id, p_action_id, v_user, v_request, v_response);
  return v_response;
end;
$$;

-- Replace the existing account Chess action with an additive bot transition. A
-- human move and its optional bot reply commit together while holding the same
-- room and match locks. If takeover wins the locks first, the bot seat is gone;
-- if the move wins first, takeover sees its new committed version/state.
create or replace function public.ludo_chess_move(
  p_room_id uuid,
  p_expected_version bigint,
  p_action_id uuid,
  p_from integer,
  p_to integer,
  p_promotion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_seat integer;
  v_status text;
  v_mode text;
  v_version bigint;
  v_state jsonb;
  v_bot_seat integer;
  v_bot_move jsonb;
  v_existing private.online_match_actions%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_new_version bigint;
  v_winner uuid;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0 or p_action_id is null or p_from is null or p_to is null then
    raise exception 'Match action is invalid' using errcode = '22023';
  end if;
  select rm.seat into v_seat from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  select r.status, r.mode into v_status, v_mode from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select m.version, m.state into v_version, v_state from public.ludo_chess_matches as m where m.room_id = p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;

  v_request := pg_catalog.jsonb_build_object('type', 'chess_move', 'expected_version', p_expected_version,
    'from', p_from, 'to', p_to, 'promotion', p_promotion);
  select a.* into v_existing from private.online_match_actions as a
    where a.room_id = p_room_id and a.action_id = p_action_id;
  if found then
    if v_existing.actor_id <> v_user or v_existing.request <> v_request then
      raise exception 'Action ID was reused for a different request' using errcode = '23505';
    end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate', true);
  end if;
  if v_mode <> 'ludo_chess' or v_status <> 'active' then raise exception 'Ludo Chess room is not active' using errcode = '55000'; end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  if v_state->>'phase' <> 'active' then raise exception 'The chess game is over' using errcode = '55000'; end if;
  if (v_state->>'turn')::integer <> v_seat then raise exception 'It is not your turn' using errcode = '42501'; end if;
  if not private.ludo_chess_legal(v_state, p_from, p_to, p_promotion) then raise exception 'Illegal chess move' using errcode = '22023'; end if;

  v_state := private.ludo_chess_apply(v_state, p_from, p_to, p_promotion);
  v_new_version := v_version + 1;
  if v_state->>'phase' = 'active' then
    select b.seat into v_bot_seat from public.ludo_chess_bot_seats as b
      where b.room_id = p_room_id and b.seat = (v_state->>'turn')::integer;
    if found then
      v_bot_move := private.ludo_chess_random_legal_move(v_state);
      v_state := private.ludo_chess_apply(v_state, (v_bot_move->>'from')::integer, (v_bot_move->>'to')::integer, v_bot_move->>'promotion');
      v_new_version := v_version + 2;
    end if;
  end if;

  v_response := pg_catalog.jsonb_build_object('room_id', p_room_id, 'action_id', p_action_id,
    'duplicate', false, 'version', v_new_version, 'state', v_state);
  update public.ludo_chess_matches set version = v_new_version, state = v_state, updated_at = now()
    where room_id = p_room_id;
  if v_state->>'phase' = 'over' then
    if v_state->>'winner' is not null and v_state->>'winner' <> 'null' then
      select user_id into v_winner from public.room_members where room_id = p_room_id and seat = (v_state->>'winner')::integer;
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

revoke all on function public.create_guest_ludo_chess_room(uuid) from public, anon;
revoke all on function public.find_ludo_chess_bot_room() from public, anon;
revoke all on function public.takeover_ludo_chess_bot_room(uuid, bigint, uuid) from public, anon;
revoke all on function public.ludo_chess_move(uuid, bigint, uuid, integer, integer, text) from public, anon;
grant execute on function public.create_guest_ludo_chess_room(uuid) to authenticated;
grant execute on function public.find_ludo_chess_bot_room() to authenticated;
grant execute on function public.takeover_ludo_chess_bot_room(uuid, bigint, uuid) to authenticated;
grant execute on function public.ludo_chess_move(uuid, bigint, uuid, integer, integer, text) to authenticated;

-- Expose only member-scoped computer-seat changes through Realtime.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ludo_chess_bot_seats') then
    alter publication supabase_realtime add table public.ludo_chess_bot_seats;
  end if;
end;
$$;
