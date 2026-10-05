-- Token 2.0 account identity is cosmetic only. Existing profile RLS continues to
-- limit SELECT to the user and room participants; no guest, wallet, or currency
-- access is created by this migration. Apply only through the project's normal,
-- separately approved deployment workflow. This file is not applied here.

alter table public.profiles
  add column if not exists token_skin text not null default 'classic'
    check (token_skin in ('classic', 'royal', 'dragon', 'cyber', 'galaxy', 'fire', 'ice', 'shadow', 'diamond', 'legendary')),
  add column if not exists token_set text not null default 'inferno'
    check (token_set in ('inferno', 'frost', 'galaxy', 'royal')),
  add column if not exists token_level smallint not null default 1
    check (token_level between 1 and 5);

comment on column public.profiles.token_skin is
  'Selected free Token 2.0 cosmetic skin; no currency or purchase state.';
comment on column public.profiles.token_set is
  'Selected free four-piece Token 2.0 cosmetic set; no currency or purchase state.';
comment on column public.profiles.token_level is
  'Displayed free Token 2.0 evolution tier (1–5); match progression remains local.';

-- Existing owner-only profile UPDATE RLS remains the row-level boundary. Grant
-- only these additive columns; do not grant any wallet or currency capability.
grant update (token_skin, token_set, token_level)
  on public.profiles to authenticated;
