-- Bound room-code guessing at the authenticated RPC boundary.
-- The user bucket is authoritative; the IP bucket uses Supabase/PostgREST's
-- documented first X-Forwarded-For address when it is present and parseable.
create table if not exists private.room_join_rate_limits (
  limiter_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0)
);
alter table private.room_join_rate_limits enable row level security;
revoke all on table private.room_join_rate_limits from public, anon, authenticated;
create index if not exists room_join_rate_limits_window_idx
  on private.room_join_rate_limits (window_started_at);

create or replace function private.consume_room_join_attempt(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_headers jsonb;
  v_client_ip inet;
  v_ip_key text;
  v_user_count integer;
  v_ip_count integer;
begin
  -- Never let a caller consume a bucket on behalf of another account.
  if p_user is null or p_user is distinct from auth.uid() then
    return false;
  end if;

  -- Supabase documents request.headers -> x-forwarded-for as its Data API
  -- client-IP signal. If absent or malformed, the per-user bucket still applies.
  begin
    v_headers := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb;
    v_client_ip := nullif(
      pg_catalog.btrim(pg_catalog.split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)),
      ''
    )::inet;
  exception when others then
    v_client_ip := null;
  end;

  insert into private.room_join_rate_limits as current_limit
    (limiter_key, window_started_at, attempts)
  values ('user:' || p_user::text, v_now, 1)
  on conflict (limiter_key) do update
    set window_started_at = case
          when current_limit.window_started_at <= v_now - interval '5 minutes' then v_now
          else current_limit.window_started_at
        end,
        attempts = case
          when current_limit.window_started_at <= v_now - interval '5 minutes' then 1
          when current_limit.attempts >= 6 then 6
          else current_limit.attempts + 1
        end
  returning attempts into v_user_count;

  if v_client_ip is not null then
    -- Store only a digest of the canonical address, not the address itself.
    v_ip_key := 'ip:' || pg_catalog.encode(extensions.digest(v_client_ip::text, 'sha256'), 'hex');
    insert into private.room_join_rate_limits as current_limit
      (limiter_key, window_started_at, attempts)
    values (v_ip_key, v_now, 1)
    on conflict (limiter_key) do update
      set window_started_at = case
            when current_limit.window_started_at <= v_now - interval '5 minutes' then v_now
            else current_limit.window_started_at
          end,
          attempts = case
            when current_limit.window_started_at <= v_now - interval '5 minutes' then 1
            when current_limit.attempts >= 21 then 21
            else current_limit.attempts + 1
          end
    returning attempts into v_ip_count;
  end if;

  -- Opportunistically remove inactive keys; the indexed table otherwise has
  -- only one row per recent account or observed IP address.
  delete from private.room_join_rate_limits
  where window_started_at < v_now - interval '1 day';

  return v_user_count <= 5 and (v_ip_count is null or v_ip_count <= 20);
end;
$$;
revoke all on function private.consume_room_join_attempt(uuid) from public, anon, authenticated;

-- Keep the authenticated-only, server-assigned join path. Negative outcomes
-- intentionally share one result so code validity, expiry, room state, and
-- capacity cannot be distinguished by an invite-code guesser.
create or replace function public.join_room(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_invite_code, '')));
  v_count integer;
  v_seat integer;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if not private.consume_room_join_attempt(v_user) then
    return pg_catalog.jsonb_build_object('error', 'join_rate_limited');
  end if;
  if v_code !~ '^([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}|[A-F0-9]{16})$' then
    return pg_catalog.jsonb_build_object('error', 'invite_unavailable');
  end if;

  select r.* into v_room
  from public.rooms as r
  where exists (
      select 1 from public.room_invites as i
      where i.room_id = r.id and i.invite_code = v_code and i.expires_at > now()
    )
    or exists (
      select 1 from private.room_invite_legacy_codes as legacy
      where legacy.room_id = r.id and legacy.invite_code = v_code and legacy.expires_at > now()
    )
  for update of r;
  if not found then
    return pg_catalog.jsonb_build_object('error', 'invite_unavailable');
  end if;
  if v_room.status <> 'waiting' then
    return pg_catalog.jsonb_build_object('error', 'invite_unavailable');
  end if;
  if exists (select 1 from public.room_members where room_id = v_room.id and user_id = v_user) then
    return pg_catalog.jsonb_build_object('room_id', v_room.id, 'invite_code', v_code, 'status', v_room.status);
  end if;

  select pg_catalog.count(*)::integer into v_count
  from public.room_members where room_id = v_room.id;
  if v_count >= v_room.capacity then
    return pg_catalog.jsonb_build_object('error', 'invite_unavailable');
  end if;
  select seats.seat_no into v_seat
  from pg_catalog.generate_series(0, v_room.capacity - 1) as seats(seat_no)
  where not exists (
    select 1 from public.room_members as rm
    where rm.room_id = v_room.id and rm.seat = seats.seat_no
  )
  order by seats.seat_no
  limit 1;

  insert into public.room_members (room_id, user_id, seat, role, ready)
  values (v_room.id, v_user, v_seat, 'player', false);
  update public.rooms set updated_at = now() where id = v_room.id;
  return pg_catalog.jsonb_build_object('room_id', v_room.id, 'invite_code', v_code, 'status', v_room.status);
end;
$$;
revoke all on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;
