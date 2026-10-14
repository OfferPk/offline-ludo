-- Resignation is a voluntary concession, not a move. Either participant may resign
-- while a Ludo Chess match is active, regardless of whose turn it is.
create or replace function public.resign_ludo_chess(p_room_id uuid, p_expected_version bigint, p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_seat integer; v_status text; v_version bigint; v_state jsonb;
  v_existing private.online_match_actions%rowtype; v_request jsonb; v_response jsonb; v_new_version bigint; v_winner uuid;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0 or p_action_id is null then raise exception 'Match action is invalid' using errcode = '22023'; end if;
  select rm.seat into v_seat from public.room_members as rm where rm.room_id=p_room_id and rm.user_id=v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  select r.status into v_status from public.rooms as r where r.id=p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select m.version,m.state into v_version,v_state from public.ludo_chess_matches as m where m.room_id=p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;
  v_request := pg_catalog.jsonb_build_object('type','resign','expected_version',p_expected_version);
  select a.* into v_existing from private.online_match_actions as a where a.room_id=p_room_id and a.action_id=p_action_id;
  if found then
    if v_existing.actor_id<>v_user or v_existing.request<>v_request then raise exception 'Action ID was reused for a different request' using errcode = '23505'; end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate',true);
  end if;
  if v_status <> 'active' or v_state->>'phase' <> 'active' then raise exception 'Chess game is not active' using errcode = '55000'; end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  v_state := pg_catalog.jsonb_set(v_state,'{phase}','"over"'::jsonb,true);
  v_state := pg_catalog.jsonb_set(v_state,'{result}','"resignation"'::jsonb,true);
  v_state := pg_catalog.jsonb_set(v_state,'{winner}',pg_catalog.to_jsonb(1-v_seat),true);
  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object('room_id',p_room_id,'action_id',p_action_id,'duplicate',false,'version',v_new_version,'state',v_state);
  update public.ludo_chess_matches set version=v_new_version,state=v_state,updated_at=now() where room_id=p_room_id;
  select user_id into v_winner from public.room_members where room_id=p_room_id and seat=1-v_seat;
  update public.rooms set status='completed',finished_at=now(),updated_at=now() where id=p_room_id;
  update public.match_history set status='completed',winner_id=v_winner,result=pg_catalog.jsonb_build_object('version',v_new_version,'state',v_state),finished_at=now() where room_id=p_room_id and status='active';
  insert into private.online_match_actions (room_id,action_id,actor_id,request,response) values (p_room_id,p_action_id,v_user,v_request,v_response);
  return v_response;
end;
$$;

revoke all on function public.resign_ludo_chess(uuid,bigint,uuid) from public, anon;
grant execute on function public.resign_ludo_chess(uuid,bigint,uuid) to authenticated;
