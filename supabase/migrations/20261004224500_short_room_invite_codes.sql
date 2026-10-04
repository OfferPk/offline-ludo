-- Use six uppercase, ambiguity-free characters for newly shared room invites.
-- Old URL tokens remain joinable only until their original expiration.

create table if not exists private.room_invite_legacy_codes (
  invite_code text primary key check (invite_code ~ '^[A-F0-9]{16}$'),
  room_id uuid not null references public.rooms(id) on delete cascade,
  expires_at timestamptz not null
);
alter table private.room_invite_legacy_codes enable row level security;
revoke all on table private.room_invite_legacy_codes from public, anon, authenticated;
create index if not exists room_invite_legacy_codes_expiry_idx
  on private.room_invite_legacy_codes (expires_at);

-- Retain already-issued deep links for their original, non-extendable lifetime.
insert into private.room_invite_legacy_codes (invite_code, room_id, expires_at)
select i.invite_code, i.room_id, i.expires_at
from public.room_invites as i
where i.expires_at > now()
on conflict (invite_code) do nothing;

create or replace function private.generate_room_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_random bytea := extensions.gen_random_bytes(6);
  v_code text := '';
  v_index integer;
begin
  -- Each random byte maps evenly to one of 32 symbols (8 values per symbol).
  for v_index in 0..5 loop
    v_code := v_code || pg_catalog.substr(
      'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
      (pg_catalog.get_byte(v_random, v_index) % 32) + 1,
      1
    );
  end loop;
  return v_code;
end;
$$;
revoke all on function private.generate_room_invite_code() from public, anon, authenticated;

-- Rotate stored codes before tightening the column check. The unique index stays
-- in place; candidate collisions are checked and retried during the migration.
alter table public.room_invites
  drop constraint if exists room_invites_invite_code_check;

do $$
declare
  v_invite_id uuid;
  v_code text;
  v_attempts integer;
begin
  for v_invite_id in
    select i.id from public.room_invites as i order by i.created_at, i.id
  loop
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      v_code := private.generate_room_invite_code();
      update public.room_invites as current_invite
      set invite_code = v_code
      where current_invite.id = v_invite_id
        and not exists (
          select 1 from public.room_invites as other_invite
          where other_invite.invite_code = v_code
            and other_invite.id <> current_invite.id
        );
      if found then exit; end if;
      if v_attempts >= 20 then
        raise exception 'Could not allocate a unique room invite code during migration'
          using errcode = '54000';
      end if;
    end loop;
  end loop;
end;
$$;

alter table public.room_invites
  add constraint room_invites_invite_code_check
  check (invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$');

-- Keep the latest room-creation rules, including two-seat Ludo Chess, while
-- making unique-index conflicts an ordinary bounded retry rather than a failure.
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
  v_inserted_code text;
  v_attempts integer := 0;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic', 'mystery', 'lucky', 'ludo_chess') then
    raise exception 'Unsupported game mode' using errcode = '22023';
  end if;
  if p_capacity not in (2, 3, 4) or (p_mode = 'ludo_chess' and p_capacity <> 2) then
    raise exception 'Ludo Chess requires exactly two seats; other modes support 2, 3, or 4' using errcode = '22023';
  end if;

  insert into public.rooms (created_by, mode, capacity)
  values (v_user, p_mode, p_capacity)
  returning id into v_room_id;
  insert into public.room_members (room_id, user_id, seat, role, ready)
  values (v_room_id, v_user, 0, 'host', true);

  loop
    v_attempts := v_attempts + 1;
    v_code := private.generate_room_invite_code();
    v_inserted_code := null;
    insert into public.room_invites (room_id, inviter_id, invite_code)
    values (v_room_id, v_user, v_code)
    on conflict (invite_code) do nothing
    returning invite_code into v_inserted_code;
    if v_inserted_code is not null then exit; end if;
    if v_attempts >= 20 then
      raise exception 'Could not allocate a unique room invite code; retry room creation'
        using errcode = '54000';
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_inserted_code, 'status', 'waiting');
end;
$$;

-- The normal join path accepts six-character codes. A narrowly validated,
-- expiring legacy branch keeps pre-migration ?room= URLs working until expiry.
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
  if v_code !~ '^([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}|[A-F0-9]{16})$' then
    raise exception 'Invite code is invalid' using errcode = '22023';
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
  if not found then raise exception 'Invite not found or expired' using errcode = 'P0002'; end if;
  if v_room.status <> 'waiting' then raise exception 'This room is no longer accepting players' using errcode = '55000'; end if;
  if exists (select 1 from public.room_members where room_id = v_room.id and user_id = v_user) then
    return pg_catalog.jsonb_build_object('room_id', v_room.id, 'invite_code', v_code, 'status', v_room.status);
  end if;

  select pg_catalog.count(*)::integer into v_count
  from public.room_members where room_id = v_room.id;
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
