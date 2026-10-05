-- Mutual draw offers for server-authoritative Ludo Chess.
-- Offers are metadata on the authoritative match row, bound to the position
-- at the observed match version. They never alter board legality or currency.

alter table public.ludo_chess_matches
  add column if not exists draw_offer jsonb;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'ludo_chess_matches_draw_offer_check'
      and conrelid = 'public.ludo_chess_matches'::regclass
  ) then
    alter table public.ludo_chess_matches
      add constraint ludo_chess_matches_draw_offer_check
      check (
        draw_offer is null or (
          pg_catalog.jsonb_typeof(draw_offer) = 'object'
          and draw_offer ? 'offered_by'
          and draw_offer ? 'position_version'
          and draw_offer ? 'created_at'
          and draw_offer->>'offered_by' in ('0', '1')
          and pg_catalog.jsonb_typeof(draw_offer->'position_version') = 'number'
          and (draw_offer->>'position_version') ~ '^[0-9]+$'
          and pg_catalog.jsonb_typeof(draw_offer->'created_at') = 'string'
        )
      );
  end if;
end;
$$;

-- Any committed state change, terminal result, or independent version advance
-- invalidates an existing offer. The locked row version still distinguishes the
-- offer's own version advance from a later action, in the same transaction.
create or replace function private.ludo_chess_clear_draw_offer_on_state_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state->>'phase' = 'over'
     or new.state is distinct from old.state
     or (new.version is distinct from old.version
         and new.draw_offer is not distinct from old.draw_offer) then
    new.draw_offer := null;
  end if;
  return new;
end;
$$;
revoke all on function private.ludo_chess_clear_draw_offer_on_state_change() from public, anon, authenticated;

drop trigger if exists ludo_chess_matches_clear_draw_offer on public.ludo_chess_matches;
create trigger ludo_chess_matches_clear_draw_offer
  before update of state, version, draw_offer on public.ludo_chess_matches
  for each row execute function private.ludo_chess_clear_draw_offer_on_state_change();

-- A room-level cancellation also cancels any pending offer. The match row is
-- locked only after the room row, matching the gameplay RPC lock order.
create or replace function private.ludo_chess_clear_draw_offer_on_room_cancel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status = 'cancelled' then
    update public.ludo_chess_matches
      set draw_offer = null, updated_at = now()
      where room_id = new.id and draw_offer is not null;
  end if;
  return new;
end;
$$;
revoke all on function private.ludo_chess_clear_draw_offer_on_room_cancel() from public, anon, authenticated;

drop trigger if exists rooms_clear_ludo_chess_draw_offer_on_cancel on public.rooms;
create trigger rooms_clear_ludo_chess_draw_offer_on_cancel
  after update of status on public.rooms
  for each row when (new.status = 'cancelled')
  execute function private.ludo_chess_clear_draw_offer_on_room_cancel();

create or replace function public.offer_ludo_chess_draw(
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
  v_seat integer;
  v_status text;
  v_mode text;
  v_version bigint;
  v_state jsonb;
  v_draw_offer jsonb;
  v_existing private.online_match_actions%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_new_version bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0 or p_action_id is null then
    raise exception 'Match action is invalid' using errcode = '22023';
  end if;

  select rm.seat into v_seat
    from public.room_members as rm
    where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;

  select r.status, r.mode into v_status, v_mode
    from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select m.version, m.state, m.draw_offer into v_version, v_state, v_draw_offer
    from public.ludo_chess_matches as m where m.room_id = p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;

  v_request := pg_catalog.jsonb_build_object('type', 'chess_draw_offer', 'expected_version', p_expected_version);
  select a.* into v_existing from private.online_match_actions as a
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
  if p_expected_version <> v_version then
    raise exception 'Match state is stale; refresh and try again' using errcode = '40001';
  end if;
  if v_draw_offer is not null then
    raise exception 'A draw offer is already pending' using errcode = '55000';
  end if;

  -- Either active player may offer, regardless of whose turn it is.
  v_draw_offer := pg_catalog.jsonb_build_object(
    'offered_by', v_seat,
    'position_version', v_version,
    'created_at', now()
  );
  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object(
    'room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false,
    'version', v_new_version, 'state', v_state, 'draw_offer', v_draw_offer
  );
  update public.ludo_chess_matches
    set version = v_new_version, draw_offer = v_draw_offer, updated_at = now()
    where room_id = p_room_id;
  insert into private.online_match_actions (room_id, action_id, actor_id, request, response)
    values (p_room_id, p_action_id, v_user, v_request, v_response);
  return v_response;
end;
$$;

create or replace function public.respond_ludo_chess_draw(
  p_room_id uuid,
  p_expected_version bigint,
  p_action_id uuid,
  p_response text
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
  v_draw_offer jsonb;
  v_offer_seat integer;
  v_existing private.online_match_actions%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_new_version bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0 or p_action_id is null
     or p_response is null or p_response not in ('accept', 'decline', 'withdraw') then
    raise exception 'Match action is invalid' using errcode = '22023';
  end if;

  select rm.seat into v_seat
    from public.room_members as rm
    where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;

  select r.status, r.mode into v_status, v_mode
    from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select m.version, m.state, m.draw_offer into v_version, v_state, v_draw_offer
    from public.ludo_chess_matches as m where m.room_id = p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;

  v_request := pg_catalog.jsonb_build_object(
    'type', 'chess_draw_response', 'expected_version', p_expected_version, 'response', p_response
  );
  select a.* into v_existing from private.online_match_actions as a
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
  if p_expected_version <> v_version then
    raise exception 'Match state is stale; refresh and try again' using errcode = '40001';
  end if;
  if v_draw_offer is null then raise exception 'There is no pending draw offer' using errcode = '55000'; end if;

  v_offer_seat := (v_draw_offer->>'offered_by')::integer;
  if coalesce((v_draw_offer->>'position_version')::bigint, -1) <> v_version - 1 then
    raise exception 'Draw offer is stale; refresh and try again' using errcode = '40001';
  end if;
  if p_response = 'withdraw' and v_seat <> v_offer_seat then
    raise exception 'Only the player who offered the draw can withdraw it' using errcode = '42501';
  elsif p_response in ('accept', 'decline') and v_seat = v_offer_seat then
    raise exception 'Only the other player can respond to this draw offer' using errcode = '42501';
  end if;

  v_new_version := v_version + 1;
  if p_response = 'accept' then
    v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
    v_state := pg_catalog.jsonb_set(v_state, '{result}', '"draw_agreement"'::jsonb, true);
    v_state := pg_catalog.jsonb_set(v_state, '{winner}', 'null'::jsonb, true);
  end if;
  v_response := pg_catalog.jsonb_build_object(
    'room_id', p_room_id, 'action_id', p_action_id, 'duplicate', false,
    'version', v_new_version, 'state', v_state, 'draw_offer', null
  );
  update public.ludo_chess_matches
    set version = v_new_version, state = v_state, draw_offer = null, updated_at = now()
    where room_id = p_room_id;

  if p_response = 'accept' then
    update public.rooms
      set status = 'completed', finished_at = now(), updated_at = now()
      where id = p_room_id;
    update public.match_history
      set status = 'completed', winner_id = null,
          result = pg_catalog.jsonb_build_object('version', v_new_version, 'state', v_state),
          finished_at = now()
      where room_id = p_room_id and status = 'active';
  end if;

  -- Match row, room, and history updates above commit together with this action ledger entry.
  insert into private.online_match_actions (room_id, action_id, actor_id, request, response)
    values (p_room_id, p_action_id, v_user, v_request, v_response);
  return v_response;
end;
$$;

revoke all on function public.offer_ludo_chess_draw(uuid, bigint, uuid) from public, anon;
revoke all on function public.respond_ludo_chess_draw(uuid, bigint, uuid, text) from public, anon;
grant execute on function public.offer_ludo_chess_draw(uuid, bigint, uuid) to authenticated;
grant execute on function public.respond_ludo_chess_draw(uuid, bigint, uuid, text) to authenticated;
