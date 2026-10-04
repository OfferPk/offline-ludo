-- Ludo Chess: two-player, server-authoritative standard chess.
-- Seat 0 plays Red/White (uppercase board pieces); seat 1 plays Blue/Black (lowercase).
-- Match rows are member-readable and have no direct client write path. Every action
-- is checked and committed atomically by an authenticated security-definer RPC.

alter table public.rooms drop constraint if exists rooms_mode_check;
alter table public.rooms add constraint rooms_mode_check
  check (mode in ('classic', 'mystery', 'lucky', 'ludo_chess'));
alter table public.match_history drop constraint if exists match_history_mode_check;
alter table public.match_history add constraint match_history_mode_check
  check (mode in ('classic', 'mystery', 'lucky', 'ludo_chess'));

create table if not exists public.ludo_chess_matches (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  state jsonb not null check (pg_catalog.jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.ludo_chess_matches enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'ludo_chess_matches'
      and policyname = 'Room members can read Ludo Chess matches'
  ) then
    execute $policy$
      create policy "Room members can read Ludo Chess matches"
        on public.ludo_chess_matches for select to authenticated
        using (exists (
          select 1 from public.room_members as rm
          where rm.room_id = ludo_chess_matches.room_id
            and rm.user_id = (select auth.uid())
        ))
    $policy$;
  end if;
end;
$$;
revoke all on public.ludo_chess_matches from anon, authenticated;
grant select on public.ludo_chess_matches to authenticated;

create or replace function private.ludo_chess_color(p_piece text)
returns integer
language sql immutable set search_path = ''
as $$
  select case
    when p_piece in ('P','N','B','R','Q','K') then 0
    when p_piece in ('p','n','b','r','q','k') then 1
    else null
  end;
$$;
revoke all on function private.ludo_chess_color(text) from public, anon, authenticated;

create or replace function private.ludo_chess_attacked(p_board text, p_target integer, p_by integer)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_from integer;
  v_piece text;
  v_type text;
  v_fr integer;
  v_fc integer;
  v_tr integer := p_target / 8;
  v_tc integer := p_target % 8;
  v_dr integer;
  v_dc integer;
  v_step_r integer;
  v_step_c integer;
  v_r integer;
  v_c integer;
  v_clear boolean;
begin
  if p_board is null or pg_catalog.char_length(p_board) <> 64 or p_target not between 0 and 63 or p_by not between 0 and 1 then
    return false;
  end if;
  for v_from in 0..63 loop
    v_piece := pg_catalog.substr(p_board, v_from + 1, 1);
    if private.ludo_chess_color(v_piece) is distinct from p_by then continue; end if;
    v_type := pg_catalog.lower(v_piece);
    v_fr := v_from / 8; v_fc := v_from % 8;
    v_dr := v_tr - v_fr; v_dc := v_tc - v_fc;
    if v_type = 'p' then
      if v_dr = (case when p_by = 0 then -1 else 1 end) and pg_catalog.abs(v_dc) = 1 then return true; end if;
    elsif v_type = 'n' then
      if (pg_catalog.abs(v_dr) = 2 and pg_catalog.abs(v_dc) = 1) or (pg_catalog.abs(v_dr) = 1 and pg_catalog.abs(v_dc) = 2) then return true; end if;
    elsif v_type = 'k' then
      if greatest(pg_catalog.abs(v_dr), pg_catalog.abs(v_dc)) = 1 then return true; end if;
    elsif (v_type = 'b' and pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0)
       or (v_type = 'r' and ((v_dr = 0) <> (v_dc = 0)))
       or (v_type = 'q' and ((v_dr = 0) <> (v_dc = 0) or (pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0))) then
      v_step_r := case when v_dr > 0 then 1 when v_dr < 0 then -1 else 0 end;
      v_step_c := case when v_dc > 0 then 1 when v_dc < 0 then -1 else 0 end;
      v_r := v_fr + v_step_r; v_c := v_fc + v_step_c; v_clear := true;
      while v_r <> v_tr or v_c <> v_tc loop
        if pg_catalog.substr(p_board, v_r * 8 + v_c + 1, 1) <> '.' then v_clear := false; exit; end if;
        v_r := v_r + v_step_r; v_c := v_c + v_step_c;
      end loop;
      if v_clear then return true; end if;
    end if;
  end loop;
  return false;
end;
$$;
revoke all on function private.ludo_chess_attacked(text, integer, integer) from public, anon, authenticated;

create or replace function private.ludo_chess_in_check(p_board text, p_color integer)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_king integer;
begin
  if p_board is null or pg_catalog.char_length(p_board) <> 64 or p_color not between 0 and 1 then return true; end if;
  v_king := pg_catalog.strpos(p_board, case when p_color = 0 then 'K' else 'k' end) - 1;
  if v_king < 0 then return true; end if;
  return private.ludo_chess_attacked(p_board, v_king, 1 - p_color);
end;
$$;
revoke all on function private.ludo_chess_in_check(text, integer) from public, anon, authenticated;

create or replace function private.ludo_chess_legal(p_state jsonb, p_from integer, p_to integer, p_promotion text)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_board text := p_state->>'board';
  v_piece text;
  v_target text;
  v_color integer;
  v_type text;
  v_fr integer;
  v_fc integer;
  v_tr integer;
  v_tc integer;
  v_dr integer;
  v_dc integer;
  v_dir integer;
  v_start integer;
  v_last integer;
  v_middle integer;
  v_castling text := coalesce(p_state->>'castling', '');
  v_ep integer := coalesce((p_state->>'en_passant')::integer, -1);
  v_home integer;
  v_sim text;
  v_rook text;
  v_r integer;
  v_c integer;
  v_step_r integer;
  v_step_c integer;
  v_promo text := pg_catalog.lower(coalesce(p_promotion, ''));
begin
  if v_board is null or pg_catalog.char_length(v_board) <> 64 or p_from not between 0 and 63 or p_to not between 0 and 63 or p_from = p_to then return false; end if;
  if p_state->>'phase' <> 'active' or (p_state->>'turn')::integer not between 0 and 1 then return false; end if;
  v_color := (p_state->>'turn')::integer;
  v_piece := pg_catalog.substr(v_board, p_from + 1, 1);
  v_target := pg_catalog.substr(v_board, p_to + 1, 1);
  if private.ludo_chess_color(v_piece) is distinct from v_color then return false; end if;
  if private.ludo_chess_color(v_target) = v_color or v_target in ('K','k') then return false; end if;
  v_type := pg_catalog.lower(v_piece);
  v_fr := p_from / 8; v_fc := p_from % 8;
  v_tr := p_to / 8; v_tc := p_to % 8;
  v_dr := v_tr - v_fr; v_dc := v_tc - v_fc;

  if v_type = 'p' then
    v_dir := case when v_color = 0 then -1 else 1 end;
    v_start := case when v_color = 0 then 6 else 1 end;
    v_last := case when v_color = 0 then 0 else 7 end;
    if v_tr = v_last then
      if v_promo not in ('q','r','b','n') then return false; end if;
    elsif v_promo <> '' then return false;
    end if;
    if v_dc = 0 and v_target = '.' then
      if v_dr = v_dir then null;
      elsif v_dr = 2 * v_dir and v_fr = v_start then
        v_middle := p_from + v_dir * 8;
        if pg_catalog.substr(v_board, v_middle + 1, 1) <> '.' then return false; end if;
      else return false;
      end if;
    elsif pg_catalog.abs(v_dc) = 1 and v_dr = v_dir then
      if private.ludo_chess_color(v_target) = 1 - v_color then null;
      elsif v_target = '.' and p_to = v_ep then
        if pg_catalog.substr(v_board, p_to - v_dir * 8 + 1, 1) <> (case when v_color = 0 then 'p' else 'P' end) then return false; end if;
      else return false;
      end if;
    else return false;
    end if;
  elsif p_promotion is not null then return false;
  elsif v_type = 'n' then
    if not ((pg_catalog.abs(v_dr) = 2 and pg_catalog.abs(v_dc) = 1) or (pg_catalog.abs(v_dr) = 1 and pg_catalog.abs(v_dc) = 2)) then return false; end if;
  elsif v_type = 'b' or v_type = 'r' or v_type = 'q' then
    if v_type = 'b' and not (pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0) then return false; end if;
    if v_type = 'r' and not ((v_dr = 0) <> (v_dc = 0)) then return false; end if;
    if v_type = 'q' and not (((v_dr = 0) <> (v_dc = 0)) or (pg_catalog.abs(v_dr) = pg_catalog.abs(v_dc) and v_dr <> 0)) then return false; end if;
    v_step_r := case when v_dr > 0 then 1 when v_dr < 0 then -1 else 0 end;
    v_step_c := case when v_dc > 0 then 1 when v_dc < 0 then -1 else 0 end;
    v_r := v_fr + v_step_r; v_c := v_fc + v_step_c;
    while v_r <> v_tr or v_c <> v_tc loop
      if pg_catalog.substr(v_board, v_r * 8 + v_c + 1, 1) <> '.' then return false; end if;
      v_r := v_r + v_step_r; v_c := v_c + v_step_c;
    end loop;
  elsif v_type = 'k' then
    if greatest(pg_catalog.abs(v_dr), pg_catalog.abs(v_dc)) = 1 then null;
    else
      v_home := case when v_color = 0 then 60 else 4 end;
      if p_from <> v_home or p_to not in (v_home - 2, v_home + 2) or private.ludo_chess_in_check(v_board, v_color) then return false; end if;
      if v_color = 0 and p_to = 62 then
        if pg_catalog.strpos(v_castling, 'K') = 0 or pg_catalog.substr(v_board, 64, 1) <> 'R' or pg_catalog.substr(v_board, 62, 1) <> '.' or pg_catalog.substr(v_board, 63, 1) <> '.' or private.ludo_chess_attacked(v_board, 61, 1) or private.ludo_chess_attacked(v_board, 62, 1) then return false; end if;
      elsif v_color = 0 and p_to = 58 then
        if pg_catalog.strpos(v_castling, 'Q') = 0 or pg_catalog.substr(v_board, 57, 1) <> 'R' or pg_catalog.substr(v_board, 58, 1) <> '.' or pg_catalog.substr(v_board, 59, 1) <> '.' or pg_catalog.substr(v_board, 60, 1) <> '.' or private.ludo_chess_attacked(v_board, 59, 1) or private.ludo_chess_attacked(v_board, 58, 1) then return false; end if;
      elsif v_color = 1 and p_to = 6 then
        if pg_catalog.strpos(v_castling, 'k') = 0 or pg_catalog.substr(v_board, 8, 1) <> 'r' or pg_catalog.substr(v_board, 6, 1) <> '.' or pg_catalog.substr(v_board, 7, 1) <> '.' or private.ludo_chess_attacked(v_board, 5, 0) or private.ludo_chess_attacked(v_board, 6, 0) then return false; end if;
      elsif v_color = 1 and p_to = 2 then
        if pg_catalog.strpos(v_castling, 'q') = 0 or pg_catalog.substr(v_board, 1, 1) <> 'r' or pg_catalog.substr(v_board, 2, 1) <> '.' or pg_catalog.substr(v_board, 3, 1) <> '.' or pg_catalog.substr(v_board, 4, 1) <> '.' or private.ludo_chess_attacked(v_board, 3, 0) or private.ludo_chess_attacked(v_board, 2, 0) then return false; end if;
      else return false;
      end if;
    end if;
  else return false;
  end if;

  v_sim := overlay(v_board placing '.' from (p_from + 1) for 1);
  if v_type = 'p' and v_dc <> 0 and v_target = '.' then
    v_sim := overlay(v_sim placing '.' from (p_to - v_dir * 8 + 1) for 1);
  end if;
  v_rook := v_piece;
  if v_type = 'p' and v_tr = v_last then v_rook := case when v_color = 0 then pg_catalog.upper(v_promo) else v_promo end; end if;
  v_sim := overlay(v_sim placing v_rook from (p_to + 1) for 1);
  if v_type = 'k' and pg_catalog.abs(v_dc) = 2 then
    if v_dc > 0 then
      v_sim := overlay(v_sim placing '.' from (case when v_color = 0 then 64 else 8 end) for 1);
      v_sim := overlay(v_sim placing (case when v_color = 0 then 'R' else 'r' end) from (case when v_color = 0 then 62 else 6 end) for 1);
    else
      v_sim := overlay(v_sim placing '.' from (case when v_color = 0 then 57 else 1 end) for 1);
      v_sim := overlay(v_sim placing (case when v_color = 0 then 'R' else 'r' end) from (case when v_color = 0 then 60 else 4 end) for 1);
    end if;
  end if;
  return not private.ludo_chess_in_check(v_sim, v_color);
end;
$$;
revoke all on function private.ludo_chess_legal(jsonb, integer, integer, text) from public, anon, authenticated;

create or replace function private.ludo_chess_has_legal(p_state jsonb, p_color integer)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_state jsonb;
  v_from integer;
  v_to integer;
  v_piece text;
  v_promotion text;
  v_last integer := case when p_color = 0 then 0 else 7 end;
  v_from_row integer;
  v_to_row integer;
begin
  v_state := pg_catalog.jsonb_set(p_state, '{turn}', pg_catalog.to_jsonb(p_color), true);
  for v_from in 0..63 loop
    v_piece := pg_catalog.substr(v_state->>'board', v_from + 1, 1);
    if private.ludo_chess_color(v_piece) is distinct from p_color then continue; end if;
    v_from_row := v_from / 8;
    for v_to in 0..63 loop
      if v_to = v_from then continue; end if;
      v_to_row := v_to / 8;
      if pg_catalog.lower(v_piece) = 'p' and v_to_row = v_last then
        foreach v_promotion in array array['q','r','b','n'] loop
          if private.ludo_chess_legal(v_state, v_from, v_to, v_promotion) then return true; end if;
        end loop;
      elsif private.ludo_chess_legal(v_state, v_from, v_to, null) then return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;
revoke all on function private.ludo_chess_has_legal(jsonb, integer) from public, anon, authenticated;

create or replace function private.ludo_chess_insufficient(p_board text)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_i integer;
  v_piece text;
  v_minors integer := 0;
  v_heavy integer := 0;
  v_bishops integer := 0;
  v_color integer := -1;
  v_this_color integer;
begin
  for v_i in 0..63 loop
    v_piece := pg_catalog.substr(p_board, v_i + 1, 1);
    if v_piece in ('.','K','k') then continue; end if;
    if pg_catalog.lower(v_piece) in ('b','n') then
      v_minors := v_minors + 1;
      if pg_catalog.lower(v_piece) = 'b' then
        v_bishops := v_bishops + 1;
        v_this_color := ((v_i / 8) + (v_i % 8)) % 2;
        if v_color = -1 then v_color := v_this_color; elsif v_color <> v_this_color then v_color := 2; end if;
      end if;
    else v_heavy := v_heavy + 1;
    end if;
  end loop;
  return v_heavy = 0 and (v_minors <= 1 or (v_bishops = v_minors and v_color in (0,1)));
end;
$$;
revoke all on function private.ludo_chess_insufficient(text) from public, anon, authenticated;

create or replace function private.ludo_chess_position_key(p_state jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select (p_state->>'board') || '|' || (p_state->>'turn') || '|' || coalesce(nullif(p_state->>'castling', ''), '-') || '|' || coalesce(p_state->>'en_passant', '-1');
$$;
revoke all on function private.ludo_chess_position_key(jsonb) from public, anon, authenticated;

create or replace function private.ludo_chess_draw_claimable(p_state jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_key text;
  v_repetitions integer;
begin
  if p_state->>'phase' <> 'active' then return false; end if;
  if coalesce((p_state->>'halfmove')::integer, 0) >= 100 then return true; end if;
  v_key := private.ludo_chess_position_key(p_state);
  select pg_catalog.count(*)::integer into v_repetitions
  from pg_catalog.jsonb_array_elements_text(coalesce(p_state->'position_history', '[]'::jsonb)) as h(value)
  where h.value = v_key;
  return v_repetitions >= 3;
end;
$$;
revoke all on function private.ludo_chess_draw_claimable(jsonb) from public, anon, authenticated;

create or replace function private.ludo_chess_apply(p_state jsonb, p_from integer, p_to integer, p_promotion text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_state jsonb := p_state;
  v_board text := p_state->>'board';
  v_piece text := pg_catalog.substr(p_state->>'board', p_from + 1, 1);
  v_target text := pg_catalog.substr(p_state->>'board', p_to + 1, 1);
  v_color integer := (p_state->>'turn')::integer;
  v_type text;
  v_dir integer;
  v_capture_square integer := p_to;
  v_captured text;
  v_moved text;
  v_castling text := coalesce(p_state->>'castling', '');
  v_en_passant integer := -1;
  v_next_turn integer := 1 - (p_state->>'turn')::integer;
  v_halfmove integer;
  v_fullmove integer;
  v_key text;
  v_repetitions integer;
  v_check boolean;
  v_has_move boolean;
begin
  if not private.ludo_chess_legal(p_state, p_from, p_to, p_promotion) then raise exception 'Illegal chess move' using errcode = '22023'; end if;
  v_type := pg_catalog.lower(v_piece);
  v_dir := case when v_color = 0 then -1 else 1 end;
  if v_type = 'p' and p_to % 8 <> p_from % 8 and v_target = '.' then v_capture_square := p_to - v_dir * 8; end if;
  v_captured := pg_catalog.substr(v_board, v_capture_square + 1, 1);
  v_board := overlay(v_board placing '.' from (p_from + 1) for 1);
  if v_capture_square <> p_to then v_board := overlay(v_board placing '.' from (v_capture_square + 1) for 1); end if;
  v_moved := v_piece;
  if v_type = 'p' and p_to / 8 = (case when v_color = 0 then 0 else 7 end) then v_moved := case when v_color = 0 then pg_catalog.upper(pg_catalog.lower(p_promotion)) else pg_catalog.lower(p_promotion) end; end if;
  v_board := overlay(v_board placing v_moved from (p_to + 1) for 1);
  if v_type = 'k' and pg_catalog.abs((p_to % 8) - (p_from % 8)) = 2 then
    if p_to > p_from then
      v_board := overlay(v_board placing '.' from (case when v_color = 0 then 64 else 8 end) for 1);
      v_board := overlay(v_board placing (case when v_color = 0 then 'R' else 'r' end) from (case when v_color = 0 then 62 else 6 end) for 1);
    else
      v_board := overlay(v_board placing '.' from (case when v_color = 0 then 57 else 1 end) for 1);
      v_board := overlay(v_board placing (case when v_color = 0 then 'R' else 'r' end) from (case when v_color = 0 then 60 else 4 end) for 1);
    end if;
  end if;
  if v_piece = 'K' then v_castling := replace(replace(v_castling, 'K', ''), 'Q', ''); end if;
  if v_piece = 'k' then v_castling := replace(replace(v_castling, 'k', ''), 'q', ''); end if;
  if p_from = 63 or v_capture_square = 63 then v_castling := replace(v_castling, 'K', ''); end if;
  if p_from = 56 or v_capture_square = 56 then v_castling := replace(v_castling, 'Q', ''); end if;
  if p_from = 7 or v_capture_square = 7 then v_castling := replace(v_castling, 'k', ''); end if;
  if p_from = 0 or v_capture_square = 0 then v_castling := replace(v_castling, 'q', ''); end if;
  if v_type = 'p' and pg_catalog.abs(p_to - p_from) = 16 then v_en_passant := (p_from + p_to) / 2; end if;
  v_halfmove := case when v_type = 'p' or v_captured <> '.' then 0 else coalesce((p_state->>'halfmove')::integer, 0) + 1 end;
  v_fullmove := coalesce((p_state->>'fullmove')::integer, 1) + case when v_color = 1 then 1 else 0 end;
  v_state := pg_catalog.jsonb_set(v_state, '{board}', pg_catalog.to_jsonb(v_board), true);
  v_state := pg_catalog.jsonb_set(v_state, '{turn}', pg_catalog.to_jsonb(v_next_turn), true);
  v_state := pg_catalog.jsonb_set(v_state, '{castling}', pg_catalog.to_jsonb(v_castling), true);
  v_state := pg_catalog.jsonb_set(v_state, '{en_passant}', pg_catalog.to_jsonb(v_en_passant), true);
  v_state := pg_catalog.jsonb_set(v_state, '{halfmove}', pg_catalog.to_jsonb(v_halfmove), true);
  v_state := pg_catalog.jsonb_set(v_state, '{fullmove}', pg_catalog.to_jsonb(v_fullmove), true);
  v_state := pg_catalog.jsonb_set(v_state, '{last_move}', pg_catalog.jsonb_build_object('from',p_from,'to',p_to,'promotion',case when p_promotion is null then null else pg_catalog.lower(p_promotion) end,'capture',v_captured <> '.', 'en_passant',v_capture_square <> p_to, 'castle',case when v_type='k' and pg_catalog.abs(p_to-p_from)=2 then case when p_to>p_from then 'king' else 'queen' end else null end), true);
  v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"active"'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{winner}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{result}', 'null'::jsonb, true);
  v_check := private.ludo_chess_in_check(v_board, v_next_turn);
  v_state := pg_catalog.jsonb_set(v_state, '{check}', pg_catalog.to_jsonb(v_check), true);
  v_key := private.ludo_chess_position_key(v_state);
  v_state := pg_catalog.jsonb_set(v_state, '{position_history}', coalesce(p_state->'position_history','[]'::jsonb) || pg_catalog.jsonb_build_array(v_key), true);
  v_has_move := private.ludo_chess_has_legal(v_state, v_next_turn);
  if not v_has_move then
    v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
    if v_check then
      v_state := pg_catalog.jsonb_set(v_state, '{result}', '"checkmate"'::jsonb, true);
      v_state := pg_catalog.jsonb_set(v_state, '{winner}', pg_catalog.to_jsonb(v_color), true);
    else
      v_state := pg_catalog.jsonb_set(v_state, '{result}', '"stalemate"'::jsonb, true);
      v_state := pg_catalog.jsonb_set(v_state, '{winner}', 'null'::jsonb, true);
    end if;
  else
    select pg_catalog.count(*)::integer into v_repetitions from pg_catalog.jsonb_array_elements_text(v_state->'position_history') as h(value) where h.value = v_key;
    if v_halfmove >= 150 then
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
      v_state := pg_catalog.jsonb_set(v_state, '{result}', '"draw_seventy_five_moves"'::jsonb, true);
    elsif v_repetitions >= 5 then
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
      v_state := pg_catalog.jsonb_set(v_state, '{result}', '"draw_fivefold_repetition"'::jsonb, true);
    elsif private.ludo_chess_insufficient(v_board) then
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', '"over"'::jsonb, true);
      v_state := pg_catalog.jsonb_set(v_state, '{result}', '"draw_insufficient_material"'::jsonb, true);
    end if;
  end if;
  return v_state;
end;
$$;
revoke all on function private.ludo_chess_apply(jsonb, integer, integer, text) from public, anon, authenticated;

create or replace function public.create_room(p_mode text, p_capacity integer default 2)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_room_id uuid; v_code text;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic','mystery','lucky','ludo_chess') then raise exception 'Unsupported game mode' using errcode = '22023'; end if;
  if p_capacity not in (2,3,4) or (p_mode = 'ludo_chess' and p_capacity <> 2) then raise exception 'Ludo Chess requires exactly two seats; other modes support 2, 3, or 4' using errcode = '22023'; end if;
  insert into public.rooms (created_by, mode, capacity) values (v_user, p_mode, p_capacity) returning id into v_room_id;
  insert into public.room_members (room_id, user_id, seat, role, ready) values (v_room_id, v_user, 0, 'host', true);
  loop
    v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 16));
    exit when not exists (select 1 from public.room_invites where invite_code = v_code);
  end loop;
  insert into public.room_invites (room_id, inviter_id, invite_code) values (v_room_id, v_user, v_code);
  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', 'waiting');
end;
$$;

create or replace function public.quick_match(p_mode text, p_capacity integer default 2)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_room_id uuid; v_room public.rooms%rowtype; v_code text; v_seat integer;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_mode not in ('classic','mystery','lucky','ludo_chess') then raise exception 'Unsupported game mode' using errcode = '22023'; end if;
  if p_capacity not in (2,3,4) or (p_mode = 'ludo_chess' and p_capacity <> 2) then raise exception 'Ludo Chess requires exactly two seats; other modes support 2, 3, or 4' using errcode = '22023'; end if;
  select r.id into v_room_id
  from public.rooms as r join public.room_members as own_member on own_member.room_id = r.id and own_member.user_id = v_user
  where r.status in ('waiting','active') and r.mode = p_mode and r.capacity = p_capacity
  order by r.created_at desc limit 1;
  if v_room_id is not null then
    select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
    return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', (select r.status from public.rooms as r where r.id = v_room_id));
  end if;
  select r.id into v_room_id from public.rooms as r
  where r.status = 'waiting' and r.mode = p_mode and r.capacity = p_capacity
    and (select pg_catalog.count(*) from public.room_members as rm where rm.room_id = r.id) < r.capacity
  order by r.created_at limit 1 for update skip locked;
  if v_room_id is null then return public.create_room(p_mode, p_capacity); end if;
  select r.* into v_room from public.rooms as r where r.id = v_room_id;
  select seats.seat_no into v_seat from pg_catalog.generate_series(0, v_room.capacity - 1) as seats(seat_no)
  where not exists (select 1 from public.room_members as rm where rm.room_id = v_room_id and rm.seat = seats.seat_no)
  order by seats.seat_no limit 1;
  insert into public.room_members (room_id, user_id, seat, role, ready) values (v_room_id, v_user, v_seat, 'player', false);
  update public.rooms set updated_at = now() where id = v_room_id;
  select i.invite_code into v_code from public.room_invites as i where i.room_id = v_room_id order by i.created_at desc limit 1;
  return pg_catalog.jsonb_build_object('room_id', v_room_id, 'invite_code', v_code, 'status', v_room.status);
end;
$$;

create or replace function public.start_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_room public.rooms%rowtype; v_count integer; v_unready integer;
  v_players jsonb; v_pieces jsonb := '[]'::jsonb; v_state jsonb; v_seat integer;
  v_board text := 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
  v_position text;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  select r.* into v_room from public.rooms as r where r.id = p_room_id for update;
  if not found or v_room.status <> 'waiting' then raise exception 'Room is not waiting' using errcode = '55000'; end if;
  if v_room.created_by <> v_user then raise exception 'Only the room host can start the table' using errcode = '42501'; end if;
  select pg_catalog.count(*)::integer, pg_catalog.count(*) filter (where not ready)::integer into v_count, v_unready
  from public.room_members where room_id = p_room_id;
  if v_room.mode = 'ludo_chess' then
    if v_room.capacity <> 2 or v_count <> 2 then raise exception 'Ludo Chess requires exactly two players' using errcode = '22023'; end if;
    if v_unready > 0 then raise exception 'Every player must be ready' using errcode = '55000'; end if;
    v_state := pg_catalog.jsonb_build_object(
      'protocol',1,'mode','ludo_chess','board',v_board,'turn',0,'phase','active','castling','KQkq','en_passant',-1,
      'halfmove',0,'fullmove',1,'position_history','[]'::jsonb,'last_move',null,'winner',null,'result',null,'check',false
    );
    v_position := private.ludo_chess_position_key(v_state);
    v_state := pg_catalog.jsonb_set(v_state, '{position_history}', pg_catalog.jsonb_build_array(v_position), true);
    update public.rooms set status = 'active', started_at = now(), updated_at = now() where id = p_room_id;
    insert into public.match_history (room_id, mode, status) values (p_room_id, v_room.mode, 'active');
    insert into public.ludo_chess_matches (room_id, version, state) values (p_room_id, 0, v_state);
    return pg_catalog.jsonb_build_object('room_id',p_room_id,'status','active','started_at',now(),'version',0,'state',v_state);
  end if;
  if v_room.mode <> 'classic' then raise exception 'Online gameplay supports Classic and Ludo Chess; Mystery and Lucky remain available offline' using errcode = '22023'; end if;
  if v_count < 2 then raise exception 'At least two players are required' using errcode = '22023'; end if;
  if v_unready > 0 then raise exception 'Every player must be ready' using errcode = '55000'; end if;
  select pg_catalog.jsonb_agg(seat order by seat) into v_players from public.room_members where room_id = p_room_id;
  for v_seat in 0..3 loop
    if v_players @> pg_catalog.jsonb_build_array(v_seat) then v_pieces := v_pieces || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(-1,-1,-1,-1));
    else v_pieces := v_pieces || 'null'::jsonb; end if;
  end loop;
  v_state := pg_catalog.jsonb_build_object(
    'protocol',1,'mode','classic','roll_style','star',
    'rules',pg_catalog.jsonb_build_object('rollStyle','star','safeSquares',true,'captureToEnter',false,'blocks',false,'bonusOnCapture',true,'bonusOnHome',true),
    'players',v_players,'pieces',v_pieces,'turn',(v_players->>0)::integer,'phase','roll','queue','[]'::jsonb,'sixes',0,'bonus',0,
    'ranking','[]'::jsonb,'turn_count',0,'last_roll',null,'last_action',null
  );
  update public.rooms set status = 'active', started_at = now(), updated_at = now() where id = p_room_id;
  insert into public.match_history (room_id, mode, status) values (p_room_id, v_room.mode, 'active');
  insert into public.match_states (room_id, version, state) values (p_room_id, 0, v_state);
  return pg_catalog.jsonb_build_object('room_id',p_room_id,'status','active','started_at',now(),'version',0,'state',v_state);
end;
$$;

create or replace function public.ludo_chess_move(p_room_id uuid, p_expected_version bigint, p_action_id uuid, p_from integer, p_to integer, p_promotion text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_seat integer; v_status text; v_mode text; v_version bigint; v_state jsonb;
  v_existing private.online_match_actions%rowtype; v_request jsonb; v_response jsonb; v_new_version bigint; v_winner uuid;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0 or p_action_id is null or p_from is null or p_to is null then raise exception 'Match action is invalid' using errcode = '22023'; end if;
  select rm.seat into v_seat from public.room_members as rm where rm.room_id = p_room_id and rm.user_id = v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  select r.status,r.mode into v_status,v_mode from public.rooms as r where r.id = p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select m.version,m.state into v_version,v_state from public.ludo_chess_matches as m where m.room_id = p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;
  v_request := pg_catalog.jsonb_build_object('type','chess_move','expected_version',p_expected_version,'from',p_from,'to',p_to,'promotion',p_promotion);
  select a.* into v_existing from private.online_match_actions as a where a.room_id = p_room_id and a.action_id = p_action_id;
  if found then
    if v_existing.actor_id <> v_user or v_existing.request <> v_request then raise exception 'Action ID was reused for a different request' using errcode = '23505'; end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate',true);
  end if;
  if v_mode <> 'ludo_chess' or v_status <> 'active' then raise exception 'Ludo Chess room is not active' using errcode = '55000'; end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  if v_state->>'phase' <> 'active' then raise exception 'The chess game is over' using errcode = '55000'; end if;
  if (v_state->>'turn')::integer <> v_seat then raise exception 'It is not your turn' using errcode = '42501'; end if;
  if not private.ludo_chess_legal(v_state,p_from,p_to,p_promotion) then raise exception 'Illegal chess move' using errcode = '22023'; end if;
  v_state := private.ludo_chess_apply(v_state,p_from,p_to,p_promotion);
  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object('room_id',p_room_id,'action_id',p_action_id,'duplicate',false,'version',v_new_version,'state',v_state);
  update public.ludo_chess_matches set version = v_new_version,state = v_state,updated_at = now() where room_id = p_room_id;
  if v_state->>'phase' = 'over' then
    if v_state->>'winner' is not null and v_state->>'winner' <> 'null' then select user_id into v_winner from public.room_members where room_id = p_room_id and seat = (v_state->>'winner')::integer; end if;
    update public.rooms set status = 'completed',finished_at = now(),updated_at = now() where id = p_room_id;
    update public.match_history set status = 'completed',winner_id = v_winner,result = pg_catalog.jsonb_build_object('version',v_new_version,'state',v_state),finished_at = now() where room_id = p_room_id and status = 'active';
  end if;
  insert into private.online_match_actions (room_id,action_id,actor_id,request,response) values (p_room_id,p_action_id,v_user,v_request,v_response);
  return v_response;
end;
$$;

create or replace function public.claim_ludo_chess_draw(p_room_id uuid, p_expected_version bigint, p_action_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_seat integer; v_status text; v_version bigint; v_state jsonb;
  v_existing private.online_match_actions%rowtype; v_request jsonb; v_response jsonb; v_new_version bigint;
begin
  if v_user is null then raise exception 'Sign in is required' using errcode = '28000'; end if;
  if p_room_id is null or p_expected_version is null or p_expected_version < 0 or p_action_id is null then raise exception 'Match action is invalid' using errcode = '22023'; end if;
  select rm.seat into v_seat from public.room_members as rm where rm.room_id=p_room_id and rm.user_id=v_user;
  if not found then raise exception 'You are not a member of this room' using errcode = '42501'; end if;
  select r.status into v_status from public.rooms as r where r.id=p_room_id for update;
  if not found then raise exception 'Room is unavailable' using errcode = 'P0002'; end if;
  select m.version,m.state into v_version,v_state from public.ludo_chess_matches as m where m.room_id=p_room_id for update;
  if not found then raise exception 'Ludo Chess match state is unavailable' using errcode = 'P0002'; end if;
  v_request := pg_catalog.jsonb_build_object('type','claim_draw','expected_version',p_expected_version);
  select a.* into v_existing from private.online_match_actions as a where a.room_id=p_room_id and a.action_id=p_action_id;
  if found then
    if v_existing.actor_id<>v_user or v_existing.request<>v_request then raise exception 'Action ID was reused for a different request' using errcode = '23505'; end if;
    return v_existing.response || pg_catalog.jsonb_build_object('duplicate',true);
  end if;
  if v_status <> 'active' or v_state->>'phase' <> 'active' then raise exception 'Chess game is not active' using errcode = '55000'; end if;
  if p_expected_version <> v_version then raise exception 'Match state is stale; refresh and try again' using errcode = '40001'; end if;
  if (v_state->>'turn')::integer <> v_seat then raise exception 'Only the player to move can claim a draw' using errcode = '42501'; end if;
  if not private.ludo_chess_draw_claimable(v_state) then raise exception 'A draw cannot be claimed in this position' using errcode = '22023'; end if;
  v_state := pg_catalog.jsonb_set(v_state,'{phase}','"over"'::jsonb,true);
  v_state := pg_catalog.jsonb_set(v_state,'{result}',pg_catalog.to_jsonb(case when (v_state->>'halfmove')::integer >= 100 then 'draw_fifty_move_claim' else 'draw_threefold_claim' end),true);
  v_state := pg_catalog.jsonb_set(v_state,'{winner}','null'::jsonb,true);
  v_new_version := v_version + 1;
  v_response := pg_catalog.jsonb_build_object('room_id',p_room_id,'action_id',p_action_id,'duplicate',false,'version',v_new_version,'state',v_state);
  update public.ludo_chess_matches set version=v_new_version,state=v_state,updated_at=now() where room_id=p_room_id;
  update public.rooms set status='completed',finished_at=now(),updated_at=now() where id=p_room_id;
  update public.match_history set status='completed',winner_id=null,result=pg_catalog.jsonb_build_object('version',v_new_version,'state',v_state),finished_at=now() where room_id=p_room_id and status='active';
  insert into private.online_match_actions (room_id,action_id,actor_id,request,response) values (p_room_id,p_action_id,v_user,v_request,v_response);
  return v_response;
end;
$$;

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
  if (v_state->>'turn')::integer <> v_seat then raise exception 'It is not your turn' using errcode = '42501'; end if;
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

revoke all on function public.ludo_chess_move(uuid,bigint,uuid,integer,integer,text) from public, anon;
revoke all on function public.claim_ludo_chess_draw(uuid,bigint,uuid) from public, anon;
revoke all on function public.resign_ludo_chess(uuid,bigint,uuid) from public, anon;
grant execute on function public.ludo_chess_move(uuid,bigint,uuid,integer,integer,text) to authenticated;
grant execute on function public.claim_ludo_chess_draw(uuid,bigint,uuid) to authenticated;
grant execute on function public.resign_ludo_chess(uuid,bigint,uuid) to authenticated;

-- Only the participants admitted by the row policy receive match-state updates.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ludo_chess_matches') then
    alter publication supabase_realtime add table public.ludo_chess_matches;
  end if;
end;
$$;
