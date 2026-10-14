-- Online room coin stakes. PREPARE ONLY: this migration must be reviewed by the project owner before production application.
-- Currency remains virtual and account-bound. Clients can select an entry fee but never mutate wallets.

alter table public.rooms
  add column if not exists entry_fee integer not null default 0
    check (entry_fee in (0, 50, 100, 500));

comment on column public.rooms.entry_fee is
  'Virtual cloud coin entry per room participant. Debited by the waiting-to-active trigger; 0 means a free room.';

alter table public.currency_ledger
  drop constraint if exists currency_ledger_reason_check;
alter table public.currency_ledger
  add constraint currency_ledger_reason_check
  check (reason in (
    'online_match_reward', 'cosmetic_purchase', 'referral_reward', 'admin_adjustment',
    'online_room_entry', 'online_room_payout', 'online_room_refund'
  ));

create table if not exists public.room_wagers (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_fee integer not null check (entry_fee in (50, 100, 500)),
  status text not null default 'held' check (status in ('held', 'paid', 'refunded')),
  winner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  primary key (room_id, user_id),
  check ((status = 'held' and winner_id is null and settled_at is null) or
         (status = 'paid' and winner_id is not null and settled_at is not null) or
         (status = 'refunded' and winner_id is null and settled_at is not null))
);
alter table public.room_wagers enable row level security;
revoke all on public.room_wagers from public, anon, authenticated;

create or replace function public.online_stakes_enabled()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  return pg_catalog.jsonb_build_object('enabled', true, 'version', 1);
end;
$$;
revoke all on function public.online_stakes_enabled() from public, anon;
grant execute on function public.online_stakes_enabled() to authenticated;

create or replace function public.create_wager_room(
  p_mode text,
  p_capacity integer default 2,
  p_entry_fee integer default 0,
  p_rules jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_room_id uuid;
begin
  if p_entry_fee not in (0, 50, 100, 500) then raise exception 'Entry fee must be 0, 50, 100, or 500 coins' using errcode = '22023'; end if;
  if p_entry_fee > 0 and p_mode <> 'classic' then raise exception 'Coin stakes are available for Online Classic rooms only' using errcode = '22023'; end if;
  v_result := public.create_room(p_mode, p_capacity, p_rules);
  v_room_id := (v_result->>'room_id')::uuid;
  update public.rooms set entry_fee = p_entry_fee, updated_at = now() where id = v_room_id and created_by = auth.uid() and status = 'waiting';
  if not found then raise exception 'Could not configure the new room entry fee' using errcode = '55000'; end if;
  return v_result || pg_catalog.jsonb_build_object('entry_fee', p_entry_fee);
end;
$$;

create or replace function public.quick_match_wager(
  p_mode text,
  p_capacity integer default 2,
  p_entry_fee integer default 0,
  p_rules jsonb default null
)
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
  v_rules jsonb;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic', 'ludo_chess') then raise exception 'Online gameplay supports Classic and Ludo Chess only' using errcode = '22023'; end if;
  if p_capacity not in (2, 3, 4) or (p_mode = 'ludo_chess' and p_capacity <> 2) then raise exception 'Ludo Chess requires exactly two seats; other modes support 2, 3, or 4' using errcode = '22023'; end if;
  if p_entry_fee not in (0, 50, 100, 500) then raise exception 'Entry fee must be 0, 50, 100, or 500 coins' using errcode = '22023'; end if;
  if p_entry_fee > 0 and p_mode <> 'classic' then raise exception 'Coin stakes are available for Online Classic rooms only' using errcode = '22023'; end if;
  v_rules := case when p_mode = 'classic' then private.online_ludo_normalize_rules(coalesce(p_rules, '{}'::jsonb)) else null end;

  select r.id into v_room_id
  from public.rooms as r
  join public.room_members as own_member on own_member.room_id = r.id and own_member.user_id = v_user
  where r.status in ('waiting', 'active') and r.mode = p_mode and r.capacity = p_capacity
    and r.entry_fee = p_entry_fee
    and (p_mode <> 'classic' or r.locked_rules is not distinct from v_rules)
  order by r.created_at desc
  limit 1;
  if v_room_id is not null then
    select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
    select r.* into v_room from public.rooms as r where r.id = v_room_id;
    return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', v_room.status, 'entry_fee', v_room.entry_fee, 'locked_rules', v_room.locked_rules);
  end if;

  select r.id into v_room_id
  from public.rooms as r
  where r.status = 'waiting' and r.mode = p_mode and r.capacity = p_capacity and r.entry_fee = p_entry_fee
    and (p_mode <> 'classic' or r.locked_rules is not distinct from v_rules)
    and (select pg_catalog.count(*) from public.room_members as rm where rm.room_id = r.id) < r.capacity
  order by r.created_at
  limit 1
  for update skip locked;

  if v_room_id is null then
    v_result := public.create_room(p_mode, p_capacity, p_rules);
    v_room_id := (v_result->>'room_id')::uuid;
    update public.rooms set entry_fee = p_entry_fee, updated_at = now() where id = v_room_id and created_by = v_user and status = 'waiting';
    if not found then raise exception 'Could not configure the new room entry fee' using errcode = '55000'; end if;
    return v_result || pg_catalog.jsonb_build_object('entry_fee', p_entry_fee);
  end if;

  select r.* into v_room from public.rooms as r where r.id = v_room_id for update;
  select seats.seat_no into v_seat
  from pg_catalog.generate_series(0, v_room.capacity - 1) as seats(seat_no)
  where not exists (select 1 from public.room_members as rm where rm.room_id = v_room_id and rm.seat = seats.seat_no)
  order by seats.seat_no
  limit 1;
  if v_seat is null then raise exception 'This room is full' using errcode = '54000'; end if;
  insert into public.room_members (room_id, user_id, seat, role, ready)
  values (v_room_id, v_user, v_seat, 'player', false);
  update public.rooms set updated_at = now() where id = v_room_id;
  select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', v_room.status, 'entry_fee', v_room.entry_fee, 'locked_rules', v_room.locked_rules);
end;
$$;

create or replace function private.hold_online_room_wagers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_balance bigint;
  v_after bigint;
begin
  if old.status <> 'waiting' or new.status <> 'active' or new.entry_fee = 0 then return new; end if;
  if new.mode <> 'classic' then raise exception 'Only Online Classic rooms may use a coin entry fee' using errcode = '22023'; end if;
  for v_member in
    select rm.user_id from public.room_members as rm where rm.room_id = new.id order by rm.user_id
  loop
    select w.coins into v_balance from public.wallets as w where w.user_id = v_member.user_id for update;
    if not found then raise exception 'A room participant has no cloud wallet' using errcode = 'P0002'; end if;
    if v_balance < new.entry_fee then raise exception 'Insufficient cloud coins for the room entry fee' using errcode = '22003'; end if;
    v_after := v_balance - new.entry_fee;
    update public.wallets set coins = v_after, updated_at = now() where user_id = v_member.user_id;
    insert into public.currency_ledger (user_id, asset, delta, balance_after, reason, event_key)
    values (v_member.user_id, 'coins', -new.entry_fee, v_after, 'online_room_entry',
      'online-stake-entry:' || new.id::text || ':' || v_member.user_id::text);
    insert into public.room_wagers (room_id, user_id, entry_fee, status)
    values (new.id, v_member.user_id, new.entry_fee, 'held');
  end loop;
  if not exists (select 1 from public.room_wagers as rw where rw.room_id = new.id and rw.status = 'held') then
    raise exception 'Could not escrow participant entry fees' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.hold_online_room_wagers() from public, anon, authenticated;

drop trigger if exists hold_online_room_wagers_before_start on public.rooms;
create trigger hold_online_room_wagers_before_start
  before update of status on public.rooms
  for each row execute function private.hold_online_room_wagers();

create or replace function private.refund_online_room_wagers(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wager record;
  v_balance bigint;
  v_after bigint;
begin
  for v_wager in
    select rw.user_id, rw.entry_fee from public.room_wagers as rw
    where rw.room_id = p_room_id and rw.status = 'held' order by rw.user_id for update
  loop
    select w.coins into v_balance from public.wallets as w where w.user_id = v_wager.user_id for update;
    if found then
      v_after := v_balance + v_wager.entry_fee;
      update public.wallets set coins = v_after, updated_at = now() where user_id = v_wager.user_id;
      insert into public.currency_ledger (user_id, asset, delta, balance_after, reason, event_key)
      values (v_wager.user_id, 'coins', v_wager.entry_fee, v_after, 'online_room_refund',
        'online-stake-refund:' || p_room_id::text || ':' || v_wager.user_id::text);
    end if;
    update public.room_wagers set status = 'refunded', settled_at = now()
    where room_id = p_room_id and user_id = v_wager.user_id and status = 'held';
  end loop;
end;
$$;
revoke all on function private.refund_online_room_wagers(uuid) from public, anon, authenticated;

create or replace function private.refund_online_room_wagers_after_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status = 'cancelled' then
    perform private.refund_online_room_wagers(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.refund_online_room_wagers_after_cancel() from public, anon, authenticated;
drop trigger if exists refund_online_room_wagers_after_cancel on public.rooms;
create trigger refund_online_room_wagers_after_cancel
  after update of status on public.rooms
  for each row execute function private.refund_online_room_wagers_after_cancel();

create or replace function private.pay_online_room_wager_after_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner_seat integer;
  v_winner uuid;
  v_pool bigint;
  v_balance bigint;
  v_after bigint;
begin
  if coalesce(old.state->>'phase', '') = 'over' or coalesce(new.state->>'phase', '') <> 'over' then return new; end if;
  if not exists (select 1 from public.rooms as r where r.id = new.room_id and r.mode = 'classic' and r.entry_fee > 0 and r.status = 'active') then return new; end if;
  v_winner_seat := nullif(new.state #>> '{ranking,0}', '')::integer;
  if v_winner_seat is null then
    perform private.refund_online_room_wagers(new.room_id);
    return new;
  end if;
  select rm.user_id into v_winner from public.room_members as rm where rm.room_id = new.room_id and rm.seat = v_winner_seat;
  if v_winner is null then
    perform private.refund_online_room_wagers(new.room_id);
    return new;
  end if;
  select coalesce(pg_catalog.sum(rw.entry_fee), 0) into v_pool from public.room_wagers as rw where rw.room_id = new.room_id and rw.status = 'held';
  if v_pool <= 0 then return new; end if;
  select w.coins into v_balance from public.wallets as w where w.user_id = v_winner for update;
  if not found then raise exception 'Winner cloud wallet is unavailable' using errcode = 'P0002'; end if;
  v_after := v_balance + v_pool;
  if v_after > 1000000000000 then raise exception 'Winner coin balance limit exceeded' using errcode = '22003'; end if;
  update public.wallets set coins = v_after, updated_at = now() where user_id = v_winner;
  insert into public.currency_ledger (user_id, asset, delta, balance_after, reason, event_key)
  values (v_winner, 'coins', v_pool, v_after, 'online_room_payout', 'online-stake-payout:' || new.room_id::text);
  update public.room_wagers set status = 'paid', winner_id = v_winner, settled_at = now()
  where room_id = new.room_id and status = 'held';
  return new;
end;
$$;
revoke all on function private.pay_online_room_wager_after_match() from public, anon, authenticated;
drop trigger if exists pay_online_room_wager_after_match on public.match_states;
create trigger pay_online_room_wager_after_match
  after update of state on public.match_states
  for each row execute function private.pay_online_room_wager_after_match();

revoke all on function public.create_wager_room(text, integer, integer, jsonb) from public, anon;
revoke all on function public.quick_match_wager(text, integer, integer, jsonb) from public, anon;
grant execute on function public.create_wager_room(text, integer, integer, jsonb) to authenticated;
grant execute on function public.quick_match_wager(text, integer, integer, jsonb) to authenticated;
