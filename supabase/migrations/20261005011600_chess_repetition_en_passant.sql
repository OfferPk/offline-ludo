-- Canonicalize repetition identity: an en-passant target matters only when a legal capture exists.
-- Normalize old history strings at comparison time so active games retain correct draw counts.
create or replace function private.ludo_chess_position_key(p_state jsonb)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_board text := p_state->>'board';
  v_turn integer := coalesce((p_state->>'turn')::integer, -1);
  v_ep integer := coalesce((p_state->>'en_passant')::integer, -1);
  v_from integer;
  v_has_legal_ep boolean := false;
begin
  if v_ep between 0 and 63 and v_turn between 0 and 1 and pg_catalog.char_length(v_board) = 64 then
    for v_from in 0..63 loop
      if private.ludo_chess_color(pg_catalog.substr(v_board, v_from + 1, 1)) is distinct from v_turn then continue; end if;
      if pg_catalog.lower(pg_catalog.substr(v_board, v_from + 1, 1)) <> 'p' then continue; end if;
      if (v_from / 8) <> ((v_ep / 8) + case when v_turn = 0 then 1 else -1 end) then continue; end if;
      if pg_catalog.abs((v_from % 8) - (v_ep % 8)) <> 1 then continue; end if;
      if private.ludo_chess_legal(p_state, v_from, v_ep, null) then v_has_legal_ep := true; exit; end if;
    end loop;
  end if;
  if not v_has_legal_ep then v_ep := -1; end if;
  return v_board || '|' || (p_state->>'turn') || '|' || coalesce(nullif(p_state->>'castling', ''), '-') || '|' || v_ep;
end;
$$;

revoke all on function private.ludo_chess_position_key(jsonb) from public, anon, authenticated;

create or replace function private.ludo_chess_normalize_position_key(p_key text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_board text := pg_catalog.split_part(p_key, '|', 1);
  v_turn_text text := pg_catalog.split_part(p_key, '|', 2);
  v_castling text := pg_catalog.split_part(p_key, '|', 3);
  v_ep_text text := pg_catalog.split_part(p_key, '|', 4);
  v_state jsonb;
begin
  if p_key is null or pg_catalog.char_length(v_board) <> 64 or v_turn_text not in ('0', '1')
     or v_ep_text !~ '^-?[0-9]+$' then return p_key; end if;
  if v_ep_text::integer not between -1 and 63 then return p_key; end if;
  v_state := pg_catalog.jsonb_build_object(
    'board', v_board, 'turn', v_turn_text::integer, 'phase', 'active',
    'castling', case when v_castling = '-' then '' else v_castling end,
    'en_passant', v_ep_text::integer
  );
  return private.ludo_chess_position_key(v_state);
end;
$$;
revoke all on function private.ludo_chess_normalize_position_key(text) from public, anon, authenticated;

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
  where private.ludo_chess_normalize_position_key(h.value) = v_key;
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
    select pg_catalog.count(*)::integer into v_repetitions from pg_catalog.jsonb_array_elements_text(v_state->'position_history') as h(value) where private.ludo_chess_normalize_position_key(h.value) = v_key;
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
