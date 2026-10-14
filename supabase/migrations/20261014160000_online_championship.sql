-- Online Championship: eight entrants, four quarter-finals, two semi-finals, one final.
-- PREPARE ONLY: project owner review/approval is required before production application.
-- Entry coins are virtual, held in the cloud wallet, and paid only to the final winner.

alter table public.rooms add column if not exists championship_match boolean not null default false;

create table if not exists public.online_championships (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  entry_fee integer not null check (entry_fee in (50, 100, 500)),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'completed', 'cancelled')),
  stage smallint not null default 1 check (stage between 1 and 3),
  winner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed' and winner_id is not null and completed_at is not null) or status <> 'completed')
);
create index if not exists online_championship_waiting_idx
  on public.online_championships (entry_fee, created_at) where status = 'waiting';

create table if not exists public.online_championship_entries (
  tournament_id uuid not null references public.online_championships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bracket_slot smallint not null check (bracket_slot between 0 and 7),
  status text not null default 'held' check (status in ('held', 'eliminated', 'champion', 'refunded')),
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create unique index if not exists online_championship_live_slots
  on public.online_championship_entries (tournament_id, bracket_slot) where status = 'held';
create unique index if not exists online_championship_one_live_entry_per_user
  on public.online_championship_entries (user_id) where status = 'held';
create index if not exists online_championship_entries_tournament_idx
  on public.online_championship_entries (tournament_id, bracket_slot);

create table if not exists public.online_championship_matches (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tournament_id uuid not null references public.online_championships(id) on delete cascade,
  stage smallint not null check (stage between 1 and 3),
  match_no smallint not null check (match_no between 1 and 4),
  room_id uuid not null unique references public.rooms(id) on delete restrict,
  player1_id uuid not null references auth.users(id) on delete restrict,
  player2_id uuid not null references auth.users(id) on delete restrict,
  winner_id uuid references auth.users(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tournament_id, stage, match_no),
  check (player1_id <> player2_id),
  check ((status = 'waiting' and winner_id is null and completed_at is null) or
         (status = 'completed' and winner_id is not null and completed_at is not null))
);
create index if not exists online_championship_matches_tournament_idx
  on public.online_championship_matches (tournament_id, stage, match_no);

alter table public.online_championships enable row level security;
alter table public.online_championship_entries enable row level security;
alter table public.online_championship_matches enable row level security;
revoke all on public.online_championships, public.online_championship_entries, public.online_championship_matches from public, anon, authenticated;

alter table public.currency_ledger drop constraint if exists currency_ledger_reason_check;
alter table public.currency_ledger add constraint currency_ledger_reason_check check (reason in (
  'online_match_reward', 'cosmetic_purchase', 'referral_reward', 'admin_adjustment',
  'online_room_entry', 'online_room_payout', 'online_room_refund',
  'online_championship_entry', 'online_championship_prize', 'online_championship_refund'
));

create or replace function private.create_online_championship_room(
  p_tournament_id uuid, p_stage smallint, p_match_no smallint, p_player1 uuid, p_player2 uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_rules jsonb;
begin
  if p_player1 is null or p_player2 is null or p_player1 = p_player2 then
    raise exception 'A championship match requires two distinct players' using errcode = '22023';
  end if;
  v_rules := private.online_ludo_normalize_rules('{}'::jsonb);
  insert into public.rooms (created_by, mode, capacity, status, locked_rules, entry_fee, championship_match)
  values (p_player1, 'classic', 2, 'waiting', v_rules, 0, true)
  returning id into v_room_id;
  insert into public.room_members (room_id, user_id, seat, role, ready)
  values (v_room_id, p_player1, 0, 'host', true), (v_room_id, p_player2, 1, 'player', true);
  loop
    v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 16));
    exit when not exists (select 1 from public.room_invites as i where i.invite_code = v_code);
  end loop;
  insert into public.room_invites (room_id, inviter_id, invite_code)
  values (v_room_id, p_player1, v_code);
  insert into public.online_championship_matches
    (tournament_id, stage, match_no, room_id, player1_id, player2_id)
  values (p_tournament_id, p_stage, p_match_no, v_room_id, p_player1, p_player2);
  return v_room_id;
end;
$$;
revoke all on function private.create_online_championship_room(uuid, smallint, smallint, uuid, uuid) from public, anon, authenticated;

create or replace function public.get_my_online_championship()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_entry public.online_championship_entries%rowtype;
  v_tournament public.online_championships%rowtype;
  v_room_id uuid;
  v_match_no smallint;
  v_participants integer;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select e.* into v_entry from public.online_championship_entries as e
  join public.online_championships as t on t.id = e.tournament_id
  where e.user_id = v_user
  order by e.created_at desc
  limit 1;
  if not found then return pg_catalog.jsonb_build_object('status', 'none'); end if;
  select t.* into v_tournament from public.online_championships as t where t.id = v_entry.tournament_id;
  select pg_catalog.count(*)::integer into v_participants from public.online_championship_entries as e
  where e.tournament_id = v_tournament.id and e.status <> 'refunded';
  select m.room_id, m.match_no into v_room_id, v_match_no
  from public.online_championship_matches as m
  where m.tournament_id = v_tournament.id and m.status = 'waiting'
    and v_user in (m.player1_id, m.player2_id)
  order by m.stage
  limit 1;
  return pg_catalog.jsonb_build_object(
    'tournament_id', v_tournament.id,
    'status', v_tournament.status,
    'entry_status', v_entry.status,
    'entry_fee', v_tournament.entry_fee,
    'participants', v_participants,
    'stage', case when v_tournament.status = 'active' and v_entry.status = 'held' and v_room_id is null and v_tournament.stage < 3 then v_tournament.stage + 1 else v_tournament.stage end,
    'match_no', v_match_no,
    'room_id', v_room_id,
    'champion', v_tournament.winner_id = v_user,
    'crown', v_tournament.winner_id = v_user,
    'prize', case when v_tournament.winner_id = v_user then v_tournament.entry_fee * 8 else 0 end
  );
end;
$$;
revoke all on function public.get_my_online_championship() from public, anon;
grant execute on function public.get_my_online_championship() to authenticated;

create or replace function public.enter_online_championship(p_entry_fee integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tournament_id uuid;
  v_slot integer;
  v_count integer;
  v_balance bigint;
  v_after bigint;
  v_player1 uuid;
  v_player2 uuid;
  v_i integer;
  v_room_id uuid;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_entry_fee not in (50, 100, 500) then raise exception 'Championship entry must be 50, 100, or 500 cloud coins' using errcode = '22023'; end if;

  select e.tournament_id into v_tournament_id
  from public.online_championship_entries as e
  join public.online_championships as t on t.id = e.tournament_id
  where e.user_id = v_user and e.status = 'held' and t.status in ('waiting', 'active')
  order by e.created_at desc limit 1;
  if v_tournament_id is not null then return public.get_my_online_championship(); end if;

  select t.id into v_tournament_id
  from public.online_championships as t
  where t.status = 'waiting' and t.entry_fee = p_entry_fee
    and not exists (select 1 from public.online_championship_entries as e where e.tournament_id = t.id and e.user_id = v_user)
    and (select pg_catalog.count(*) from public.online_championship_entries as e where e.tournament_id = t.id and e.status = 'held') < 8
  order by t.created_at
  limit 1
  for update;
  if v_tournament_id is null then
    insert into public.online_championships (entry_fee, status, stage)
    values (p_entry_fee, 'waiting', 1) returning id into v_tournament_id;
  end if;

  select pg_catalog.count(*)::integer into v_count from public.online_championship_entries as e
  where e.tournament_id = v_tournament_id and e.status = 'held';
  select slot_no into v_slot from pg_catalog.generate_series(0, 7) as slots(slot_no)
  where not exists (select 1 from public.online_championship_entries as e where e.tournament_id = v_tournament_id and e.bracket_slot = slots.slot_no and e.status = 'held')
  order by slot_no limit 1;
  if v_slot is null or v_count >= 8 then raise exception 'This Championship has filled; try again' using errcode = '55000'; end if;
  select w.coins into v_balance from public.wallets as w where w.user_id = v_user for update;
  if not found then raise exception 'Cloud wallet is unavailable' using errcode = 'P0002'; end if;
  if v_balance < p_entry_fee then raise exception 'Not enough cloud coins for this Championship entry' using errcode = '22003'; end if;
  v_after := v_balance - p_entry_fee;
  update public.wallets set coins = v_after, updated_at = now() where user_id = v_user;
  insert into public.currency_ledger (user_id, asset, delta, balance_after, reason, event_key)
  values (v_user, 'coins', -p_entry_fee, v_after, 'online_championship_entry',
    'online-champ-entry:' || v_tournament_id::text || ':' || v_user::text);
  insert into public.online_championship_entries (tournament_id, user_id, bracket_slot, status)
  values (v_tournament_id, v_user, v_slot, 'held');
  select pg_catalog.count(*)::integer into v_count from public.online_championship_entries as e
  where e.tournament_id = v_tournament_id and e.status = 'held';

  if v_count = 8 then
    update public.online_championships set status = 'active', stage = 1 where id = v_tournament_id;
    for v_i in 1..4 loop
      select e.user_id into v_player1 from public.online_championship_entries as e
      where e.tournament_id = v_tournament_id and e.bracket_slot = (v_i - 1) * 2 and e.status = 'held';
      select e.user_id into v_player2 from public.online_championship_entries as e
      where e.tournament_id = v_tournament_id and e.bracket_slot = (v_i - 1) * 2 + 1 and e.status = 'held';
      v_room_id := private.create_online_championship_room(v_tournament_id, 1, v_i::smallint, v_player1, v_player2);
    end loop;
  end if;
  return public.get_my_online_championship();
end;
$$;
revoke all on function public.enter_online_championship(integer) from public, anon;
grant execute on function public.enter_online_championship(integer) to authenticated;

create or replace function public.leave_online_championship()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tournament_id uuid;
  v_fee integer;
  v_balance bigint;
  v_after bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select e.tournament_id, t.entry_fee into v_tournament_id, v_fee
  from public.online_championship_entries as e
  join public.online_championships as t on t.id = e.tournament_id
  where e.user_id = v_user and e.status = 'held' and t.status = 'waiting'
  order by e.created_at desc limit 1 for update of e, t;
  if v_tournament_id is null then raise exception 'Only a waiting Championship entry can be refunded' using errcode = '55000'; end if;
  select w.coins into v_balance from public.wallets as w where w.user_id = v_user for update;
  if not found then raise exception 'Cloud wallet is unavailable' using errcode = 'P0002'; end if;
  v_after := v_balance + v_fee;
  if v_after > 1000000000000 then raise exception 'Cloud wallet balance limit exceeded' using errcode = '22003'; end if;
  update public.wallets set coins = v_after, updated_at = now() where user_id = v_user;
  insert into public.currency_ledger (user_id, asset, delta, balance_after, reason, event_key)
  values (v_user, 'coins', v_fee, v_after, 'online_championship_refund',
    'online-champ-refund:' || v_tournament_id::text || ':' || v_user::text);
  update public.online_championship_entries set status = 'refunded'
  where tournament_id = v_tournament_id and user_id = v_user and status = 'held';
  if not exists (select 1 from public.online_championship_entries as e where e.tournament_id = v_tournament_id and e.status = 'held') then
    update public.online_championships set status = 'cancelled' where id = v_tournament_id and status = 'waiting';
  end if;
  return pg_catalog.jsonb_build_object('status', 'refunded', 'entry_fee', v_fee);
end;
$$;
revoke all on function public.leave_online_championship() from public, anon;
grant execute on function public.leave_online_championship() to authenticated;

create or replace function private.resolve_online_championship_match(p_room_id uuid, p_winner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.online_championship_matches%rowtype;
  v_tournament public.online_championships%rowtype;
  v_player1 uuid;
  v_player2 uuid;
  v_fee integer;
  v_balance bigint;
  v_after bigint;
  v_prize bigint;
  v_i integer;
  v_room_id uuid;
begin
  select m.* into v_match from public.online_championship_matches as m
  where m.room_id = p_room_id and m.status = 'waiting' for update;
  if not found then return; end if;
  if p_winner_id not in (v_match.player1_id, v_match.player2_id) then return; end if;
  update public.online_championship_matches set status = 'completed', winner_id = p_winner_id, completed_at = now()
  where id = v_match.id and status = 'waiting';
  if not found then return; end if;
  update public.online_championship_entries set status = 'eliminated'
  where tournament_id = v_match.tournament_id and user_id in (v_match.player1_id, v_match.player2_id)
    and user_id <> p_winner_id and status = 'held';
  select t.* into v_tournament from public.online_championships as t where t.id = v_match.tournament_id for update;
  if not found or v_tournament.status <> 'active' then return; end if;
  -- The locked stage makes round creation idempotent when simultaneous matches finish together.
  if v_tournament.stage <> v_match.stage then return; end if;

  if v_match.stage = 1 then
    if exists (select 1 from public.online_championship_matches as m where m.tournament_id = v_match.tournament_id and m.stage = 1 and m.status <> 'completed') then return; end if;
    for v_i in 1..2 loop
      select m.winner_id into v_player1 from public.online_championship_matches as m
      where m.tournament_id = v_match.tournament_id and m.stage = 1 and m.match_no = (v_i - 1) * 2 + 1;
      select m.winner_id into v_player2 from public.online_championship_matches as m
      where m.tournament_id = v_match.tournament_id and m.stage = 1 and m.match_no = (v_i - 1) * 2 + 2;
      v_room_id := private.create_online_championship_room(v_match.tournament_id, 2, v_i::smallint, v_player1, v_player2);
    end loop;
    update public.online_championships set stage = 2 where id = v_match.tournament_id;
    return;
  end if;

  if v_match.stage = 2 then
    if exists (select 1 from public.online_championship_matches as m where m.tournament_id = v_match.tournament_id and m.stage = 2 and m.status <> 'completed') then return; end if;
    select m.winner_id into v_player1 from public.online_championship_matches as m
    where m.tournament_id = v_match.tournament_id and m.stage = 2 and m.match_no = 1;
    select m.winner_id into v_player2 from public.online_championship_matches as m
    where m.tournament_id = v_match.tournament_id and m.stage = 2 and m.match_no = 2;
    v_room_id := private.create_online_championship_room(v_match.tournament_id, 3, 1, v_player1, v_player2);
    update public.online_championships set stage = 3 where id = v_match.tournament_id;
    return;
  end if;

  v_fee := v_tournament.entry_fee;
  v_prize := v_fee::bigint * 8;
  select w.coins into v_balance from public.wallets as w where w.user_id = p_winner_id for update;
  if not found then raise exception 'Championship winner wallet is unavailable' using errcode = 'P0002'; end if;
  v_after := v_balance + v_prize;
  if v_after > 1000000000000 then raise exception 'Championship prize exceeds the wallet balance limit' using errcode = '22003'; end if;
  update public.wallets set coins = v_after, updated_at = now() where user_id = p_winner_id;
  insert into public.currency_ledger (user_id, asset, delta, balance_after, reason, event_key)
  values (p_winner_id, 'coins', v_prize, v_after, 'online_championship_prize',
    'online-champ-prize:' || v_match.tournament_id::text);
  update public.online_championship_entries set status = case when user_id = p_winner_id then 'champion' else 'eliminated' end
  where tournament_id = v_match.tournament_id and status = 'held';
  update public.online_championships set status = 'completed', winner_id = p_winner_id, completed_at = now()
  where id = v_match.tournament_id;
end;
$$;
revoke all on function private.resolve_online_championship_match(uuid, uuid) from public, anon, authenticated;

create or replace function private.advance_online_championship_after_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner_seat integer;
  v_winner_id uuid;
begin
  if coalesce(old.state->>'phase', '') = 'over' or coalesce(new.state->>'phase', '') <> 'over' then return new; end if;
  if not exists (select 1 from public.online_championship_matches as m where m.room_id = new.room_id and m.status = 'waiting') then return new; end if;
  v_winner_seat := nullif(new.state #>> '{ranking,0}', '')::integer;
  if v_winner_seat is null then return new; end if;
  select rm.user_id into v_winner_id from public.room_members as rm
  where rm.room_id = new.room_id and rm.seat = v_winner_seat;
  if v_winner_id is not null then perform private.resolve_online_championship_match(new.room_id, v_winner_id); end if;
  return new;
end;
$$;
revoke all on function private.advance_online_championship_after_match() from public, anon, authenticated;
drop trigger if exists advance_online_championship_after_match on public.match_states;
create trigger advance_online_championship_after_match
  after update of state on public.match_states
  for each row execute function private.advance_online_championship_after_match();

create or replace function private.advance_online_championship_after_forfeit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.online_championship_matches%rowtype;
  v_leaver uuid := auth.uid();
  v_winner uuid;
begin
  if old.status not in ('waiting', 'active') or new.status <> 'cancelled' or v_leaver is null then return new; end if;
  select m.* into v_match from public.online_championship_matches as m
  where m.room_id = new.id and m.status = 'waiting';
  if not found then return new; end if;
  if v_leaver = v_match.player1_id then v_winner := v_match.player2_id;
  elsif v_leaver = v_match.player2_id then v_winner := v_match.player1_id;
  else return new;
  end if;
  perform private.resolve_online_championship_match(new.id, v_winner);
  return new;
end;
$$;
revoke all on function private.advance_online_championship_after_forfeit() from public, anon, authenticated;
drop trigger if exists advance_online_championship_after_forfeit on public.rooms;
create trigger advance_online_championship_after_forfeit
  after update of status on public.rooms
  for each row execute function private.advance_online_championship_after_forfeit();

create or replace function private.cancel_championship_room_after_member_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.online_championship_matches as m where m.room_id = old.room_id and m.status = 'waiting') then return old; end if;
  update public.rooms set status = 'cancelled', finished_at = now(), updated_at = now()
  where id = old.room_id and status = 'waiting';
  return old;
end;
$$;
revoke all on function private.cancel_championship_room_after_member_leave() from public, anon, authenticated;
drop trigger if exists cancel_championship_room_after_member_leave on public.room_members;
create trigger cancel_championship_room_after_member_leave
  after delete on public.room_members
  for each row execute function private.cancel_championship_room_after_member_leave();

create or replace function public.online_stakes_enabled()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  return pg_catalog.jsonb_build_object('enabled', true, 'version', 2, 'championships', true);
end;
$$;
revoke all on function public.online_stakes_enabled() from public, anon;
grant execute on function public.online_stakes_enabled() to authenticated;
