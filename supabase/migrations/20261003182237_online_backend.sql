-- Crossfour online backend foundation.
-- All application state transitions below are atomic Postgres functions.
-- Currency mutations and match completion are service_role-only; client roles
-- can read their own wallet and participate in invite-room lobbies only.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  diamonds bigint not null default 0 check (diamonds >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.currency_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null check (asset in ('coins', 'diamonds')),
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null check (reason in ('online_match_reward', 'cosmetic_purchase', 'referral_reward', 'admin_adjustment')),
  event_key text not null check (char_length(event_key) between 8 and 128),
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create table if not exists public.rooms (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  mode text not null check (mode in ('classic', 'mystery', 'lucky')),
  capacity smallint not null check (capacity in (2, 3, 4)),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists rooms_waiting_match_idx on public.rooms (mode, capacity, created_at) where status = 'waiting';

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  role text not null default 'player' check (role in ('host', 'player')),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);
create index if not exists room_members_user_idx on public.room_members (user_id, room_id);

create table if not exists public.room_invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique check (invite_code ~ '^[A-F0-9]{16}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists room_invites_room_idx on public.room_invites (room_id);

create table if not exists public.match_history (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  room_id uuid not null unique references public.rooms(id) on delete restrict,
  mode text not null check (mode in ('classic', 'mystery', 'lucky')),
  status text not null check (status in ('active', 'completed', 'abandoned')),
  winner_id uuid references auth.users(id) on delete set null,
  result jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(result) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists match_history_started_idx on public.match_history (started_at desc);

create or replace function private.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members as rm
    where rm.room_id = p_room_id
      and rm.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_room_member(uuid) from public, anon;
grant execute on function private.is_room_member(uuid) to authenticated;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_handle text;
begin
  v_display_name := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    ),
    32
  );
  v_handle := 'p_' || pg_catalog.substr(pg_catalog.replace(new.id::text, '-', ''), 1, 12);

  insert into public.profiles (id, handle, display_name)
  values (new.id, v_handle, v_display_name)
  on conflict (id) do nothing;

  insert into public.wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_crossfour on auth.users;
create trigger on_auth_user_created_crossfour
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.currency_ledger enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;
alter table public.match_history enable row level security;

create policy "Users can read their own and room participants profiles"
  on public.profiles for select to authenticated
  using (
    (select auth.uid()) = id
    or exists (
      select 1
      from public.room_members as target_member
      join public.room_members as viewer_member on viewer_member.room_id = target_member.room_id
      where target_member.user_id = profiles.id
        and viewer_member.user_id = (select auth.uid())
    )
  );
create policy "Users can update their own display name"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy "Users can read their own wallet"
  on public.wallets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can read their own currency ledger"
  on public.currency_ledger for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Room members can read their room"
  on public.rooms for select to authenticated
  using ((select private.is_room_member(id)));
create policy "Room members can read member roster"
  on public.room_members for select to authenticated
  using ((select private.is_room_member(room_id)));
create policy "Room members can read room invite codes"
  on public.room_invites for select to authenticated
  using ((select private.is_room_member(room_id)));
create policy "Participants can read match history"
  on public.match_history for select to authenticated
  using (
    exists (
      select 1 from public.room_members as rm
      where rm.room_id = match_history.room_id
        and rm.user_id = (select auth.uid())
    )
  );

revoke all on public.profiles, public.wallets, public.currency_ledger,
  public.rooms, public.room_members, public.room_invites, public.match_history
  from anon, authenticated;
grant select on public.profiles, public.wallets, public.currency_ledger,
  public.rooms, public.room_members, public.room_invites, public.match_history
  to authenticated;
grant update (display_name) on public.profiles to authenticated;

create or replace function public.create_room(p_mode text, p_capacity integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
  v_code text;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic', 'mystery', 'lucky') then raise exception 'Unsupported game mode' using errcode = '22023'; end if;
  if p_capacity not in (2, 3, 4) then raise exception 'Room capacity must be 2, 3, or 4' using errcode = '22023'; end if;

  insert into public.rooms (created_by, mode, capacity)
  values (v_user, p_mode, p_capacity)
  returning id into v_room_id;

  insert into public.room_members (room_id, user_id, seat, role, ready)
  values (v_room_id, v_user, 0, 'host', true);

  loop
    v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 16));
    exit when not exists (select 1 from public.room_invites where invite_code = v_code);
  end loop;
  insert into public.room_invites (room_id, inviter_id, invite_code)
  values (v_room_id, v_user, v_code);

  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', 'waiting');
end;
$$;

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
  if v_code !~ '^[A-F0-9]{16}$' then raise exception 'Invite code is invalid' using errcode = '22023'; end if;

  select r.* into v_room
  from public.rooms as r
  join public.room_invites as i on i.room_id = r.id
  where i.invite_code = v_code and i.expires_at > now()
  for update of r;
  if not found then raise exception 'Invite not found or expired' using errcode = 'P0002'; end if;
  if v_room.status <> 'waiting' then raise exception 'This room is no longer accepting players' using errcode = '55000'; end if;
  if exists (select 1 from public.room_members where room_id = v_room.id and user_id = v_user) then
    return pg_catalog.jsonb_build_object('room_id', v_room.id, 'invite_code', v_code, 'status', v_room.status);
  end if;

  select pg_catalog.count(*)::integer into v_count from public.room_members where room_id = v_room.id;
  if v_count >= v_room.capacity then raise exception 'This room is full' using errcode = '54000'; end if;
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

create or replace function public.quick_match(p_mode text, p_capacity integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
  v_room public.rooms%rowtype;
  v_code text;
  v_seat integer;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic', 'mystery', 'lucky') then raise exception 'Unsupported game mode' using errcode = '22023'; end if;
  if p_capacity not in (2, 3, 4) then raise exception 'Room capacity must be 2, 3, or 4' using errcode = '22023'; end if;

  select r.id into v_room_id
  from public.rooms as r
  join public.room_members as own_member on own_member.room_id = r.id and own_member.user_id = v_user
  where r.status in ('waiting', 'active')
  order by r.created_at desc
  limit 1;
  if v_room_id is not null then
    select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
    return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', (select r.status from public.rooms as r where r.id = v_room_id));
  end if;

  select r.id into v_room_id
  from public.rooms as r
  where r.status = 'waiting'
    and r.mode = p_mode
    and r.capacity = p_capacity
    and (select pg_catalog.count(*) from public.room_members as rm where rm.room_id = r.id) < r.capacity
  order by r.created_at
  limit 1
  for update skip locked;

  if v_room_id is null then
    return public.create_room(p_mode, p_capacity);
  end if;

  select r.* into v_room from public.rooms as r where r.id = v_room_id;
  select seats.seat_no into v_seat
  from pg_catalog.generate_series(0, v_room.capacity - 1) as seats(seat_no)
  where not exists (
    select 1 from public.room_members as rm where rm.room_id = v_room_id and rm.seat = seats.seat_no
  )
  order by seats.seat_no
  limit 1;
  insert into public.room_members (room_id, user_id, seat, role, ready)
  values (v_room_id, v_user, v_seat, 'player', false);
  update public.rooms set updated_at = now() where id = v_room_id;
  select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', v_room.status);
end;
$$;

create or replace function public.set_room_ready(p_room_id uuid, p_ready boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select r.status into v_status from public.rooms as r where r.id = p_room_id for update;
  if not found or v_status <> 'waiting' then raise exception 'Room is not waiting for players' using errcode = '55000'; end if;
  update public.room_members set ready = p_ready
  where room_id = p_room_id and user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  update public.rooms set updated_at = now() where id = p_room_id;
  return p_ready;
end;
$$;

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
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select r.* into v_room from public.rooms as r where r.id = p_room_id for update;
  if not found or v_room.status <> 'waiting' then raise exception 'Room is not waiting' using errcode = '55000'; end if;
  if v_room.created_by <> v_user then raise exception 'Only the room host can start the table' using errcode = '42501'; end if;
  select pg_catalog.count(*)::integer, pg_catalog.count(*) filter (where not ready)::integer
    into v_count, v_unready
  from public.room_members where room_id = p_room_id;
  if v_count < 2 then raise exception 'At least two players are required' using errcode = '22023'; end if;
  if v_unready > 0 then raise exception 'Every player must be ready' using errcode = '55000'; end if;

  update public.rooms set status = 'active', started_at = now(), updated_at = now() where id = p_room_id;
  insert into public.match_history (room_id, mode, status)
  values (p_room_id, v_room.mode, 'active');
  return pg_catalog.jsonb_build_object('room_id', p_room_id, 'status', 'active', 'started_at', now());
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms%rowtype;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select r.* into v_room from public.rooms as r where r.id = p_room_id for update;
  if not found then return false; end if;
  if not exists (select 1 from public.room_members where room_id = p_room_id and user_id = v_user) then
    raise exception 'You are not a member of this room' using errcode = '42501';
  end if;

  if v_room.status = 'active' then
    update public.rooms set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_room_id;
    update public.match_history set status = 'abandoned', finished_at = now(), result = '{"reason":"player_left"}'::jsonb where room_id = p_room_id and status = 'active';
  elsif v_room.status = 'waiting' and v_room.created_by = v_user then
    update public.rooms set status = 'cancelled', finished_at = now(), updated_at = now() where id = p_room_id;
  elsif v_room.status = 'waiting' then
    delete from public.room_members where room_id = p_room_id and user_id = v_user;
    update public.rooms set updated_at = now() where id = p_room_id;
  end if;
  return true;
end;
$$;

-- Called only by a trusted server after independently validating the match.
-- There is intentionally no client-callable result or reward endpoint.
create or replace function public.finalize_match(p_room_id uuid, p_winner_id uuid, p_result jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_history public.match_history%rowtype;
begin
  if p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object' or pg_catalog.octet_length(p_result::text) > 8192 then
    raise exception 'Result payload is invalid' using errcode = '22023';
  end if;
  select r.* into v_room from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room not found' using errcode = 'P0002'; end if;
  if v_room.status = 'completed' then
    select h.* into v_history from public.match_history as h where h.room_id = p_room_id;
    return pg_catalog.to_jsonb(v_history);
  end if;
  if v_room.status <> 'active' then raise exception 'Room is not active' using errcode = '55000'; end if;
  if p_winner_id is not null and not exists (
    select 1 from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = p_winner_id
  ) then raise exception 'Winner must be a room participant' using errcode = '22023'; end if;

  update public.rooms set status = 'completed', finished_at = now(), updated_at = now() where id = p_room_id;
  update public.match_history
    set status = 'completed', winner_id = p_winner_id, result = p_result, finished_at = now()
    where room_id = p_room_id returning * into v_history;
  return pg_catalog.to_jsonb(v_history);
end;
$$;

-- Atomic, idempotent balance mutation. Only trusted backend/service_role code
-- may call this after validating a reward or purchase server-side.
create or replace function public.post_currency_transaction(
  p_user_id uuid,
  p_asset text,
  p_delta bigint,
  p_reason text,
  p_event_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.currency_ledger%rowtype;
  v_current bigint;
  v_next bigint;
begin
  if p_user_id is null or p_asset not in ('coins', 'diamonds') or p_delta = 0
     or pg_catalog.abs(p_delta) > 1000000000
     or p_reason not in ('online_match_reward', 'cosmetic_purchase', 'referral_reward', 'admin_adjustment')
     or p_event_key is null or pg_catalog.char_length(p_event_key) not between 8 and 128 then
    raise exception 'Currency transaction is invalid' using errcode = '22023';
  end if;

  select w.* into v_wallet from public.wallets as w where w.user_id = p_user_id for update;
  if not found then raise exception 'Wallet not found' using errcode = 'P0002'; end if;
  select l.* into v_existing from public.currency_ledger as l where l.user_id = p_user_id and l.event_key = p_event_key;
  if found then
    if v_existing.asset <> p_asset or v_existing.delta <> p_delta or v_existing.reason <> p_reason then
      raise exception 'Event key was already used for a different transaction' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('user_id', p_user_id, 'coins', v_wallet.coins, 'diamonds', v_wallet.diamonds, 'duplicate', true);
  end if;

  v_current := case when p_asset = 'coins' then v_wallet.coins else v_wallet.diamonds end;
  v_next := v_current + p_delta;
  if v_next < 0 then raise exception 'Insufficient balance' using errcode = '22003'; end if;
  if v_next > 1000000000000 then raise exception 'Balance limit exceeded' using errcode = '22003'; end if;

  insert into public.currency_ledger (user_id, asset, delta, balance_after, reason, event_key)
  values (p_user_id, p_asset, p_delta, v_next, p_reason, p_event_key);
  if p_asset = 'coins' then
    update public.wallets set coins = v_next, updated_at = now() where user_id = p_user_id returning * into v_wallet;
  else
    update public.wallets set diamonds = v_next, updated_at = now() where user_id = p_user_id returning * into v_wallet;
  end if;
  return pg_catalog.jsonb_build_object('user_id', p_user_id, 'coins', v_wallet.coins, 'diamonds', v_wallet.diamonds, 'duplicate', false);
end;
$$;

revoke all on function public.create_room(text, integer) from public, anon;
revoke all on function public.join_room(text) from public, anon;
revoke all on function public.quick_match(text, integer) from public, anon;
revoke all on function public.set_room_ready(uuid, boolean) from public, anon;
revoke all on function public.start_room(uuid) from public, anon;
revoke all on function public.leave_room(uuid) from public, anon;
revoke all on function public.finalize_match(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.post_currency_transaction(uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.create_room(text, integer) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.quick_match(text, integer) to authenticated;
grant execute on function public.set_room_ready(uuid, boolean) to authenticated;
grant execute on function public.start_room(uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.finalize_match(uuid, uuid, jsonb) to service_role;
grant execute on function public.post_currency_transaction(uuid, text, bigint, text, text) to service_role;

-- Postgres Changes drives lobby roster/status updates. The publication is
-- modified only if it exists and the table is not already present.
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['rooms', 'room_members', 'room_invites', 'match_history', 'wallets'] loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute pg_catalog.format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;
