-- Online Classic Quick Chat uses only the existing fixed phrases and emotes.
-- No free-form user text is stored or broadcast.
create table public.room_chat_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (message in (
    'Good luck!', 'Nice move!', 'Oops!', 'So close!', 'Well played!',
    'Let''s go!', 'Not again…', 'Your turn!',
    ':smile', ':laugh', ':wow', ':sad', ':angry', ':cool', ':think', ':love'
  )),
  created_at timestamptz not null default pg_catalog.now()
);

create index room_chat_messages_room_created_idx
  on public.room_chat_messages (room_id, created_at desc);

alter table public.room_chat_messages enable row level security;
create policy online_room_chat_members_read
  on public.room_chat_messages
  for select to authenticated
  using (exists (
    select 1
    from public.room_members as rm
    where rm.room_id = room_chat_messages.room_id
      and rm.user_id = (select auth.uid())
  ));
revoke all on table public.room_chat_messages from public, anon, authenticated;
grant select on table public.room_chat_messages to authenticated;

create table private.online_room_chat_rate_limits (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_sent_at timestamptz not null,
  primary key (room_id, user_id)
);
alter table private.online_room_chat_rate_limits enable row level security;
revoke all on table private.online_room_chat_rate_limits from public, anon, authenticated;

create or replace function public.send_room_chat(p_room_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_mode text;
  v_status text;
  v_last_sent_at timestamptz;
  v_now timestamptz;
  v_message public.room_chat_messages%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in to use Online Quick Chat.' using errcode = '28000';
  end if;

  if p_message is null or p_message not in (
    'Good luck!', 'Nice move!', 'Oops!', 'So close!', 'Well played!',
    'Let''s go!', 'Not again…', 'Your turn!',
    ':smile', ':laugh', ':wow', ':sad', ':angry', ':cool', ':think', ':love'
  ) then
    raise exception 'Choose one of the available Quick Chat messages.' using errcode = '22023';
  end if;

  select r.mode, r.status
    into v_mode, v_status
  from public.rooms as r
  where r.id = p_room_id
  for share;

  if not found or v_mode <> 'classic' or v_status <> 'active' then
    raise exception 'Quick Chat is available only in an active Online Classic match.' using errcode = '22023';
  end if;

  perform 1
  from public.room_members as rm
  where rm.room_id = p_room_id
    and rm.user_id = v_user_id
  for share;

  if not found then
    raise exception 'You are not a member of this room.' using errcode = '42501';
  end if;

  insert into private.online_room_chat_rate_limits (room_id, user_id, last_sent_at)
  values (p_room_id, v_user_id, pg_catalog.clock_timestamp() - interval '2 seconds')
  on conflict (room_id, user_id) do nothing;

  select limits.last_sent_at
    into v_last_sent_at
  from private.online_room_chat_rate_limits as limits
  where limits.room_id = p_room_id
    and limits.user_id = v_user_id
  for update;

  v_now := pg_catalog.clock_timestamp();
  if v_last_sent_at > v_now - interval '2 seconds' then
    raise exception 'Please wait a moment before sending another Quick Chat message.' using errcode = 'P0001';
  end if;

  update private.online_room_chat_rate_limits as limits
  set last_sent_at = v_now
  where limits.room_id = p_room_id
    and limits.user_id = v_user_id;

  insert into public.room_chat_messages (room_id, user_id, message)
  values (p_room_id, v_user_id, p_message)
  returning * into v_message;

  return pg_catalog.to_jsonb(v_message);
end;
$$;

revoke all on function public.send_room_chat(uuid, text) from public, anon;
grant execute on function public.send_room_chat(uuid, text) to authenticated;

-- Supabase applies row-level security to Postgres Changes delivery. Keep the
-- table in the default Realtime publication without duplicating an existing entry.
do $$
begin
  if exists (
       select 1
       from pg_catalog.pg_publication
       where pubname = 'supabase_realtime'
         and not puballtables
     )
     and not exists (
       select 1
       from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'room_chat_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.room_chat_messages';
  end if;
end
$$;
