-- Services marketplace closed beta (CR-007, specs/marketplace/02-design.md §12, ADR-012).
-- Audience setting, single-use invites bound to an email, beta members, and the `provider_terms` consent kind.
-- NO MONEY (NFR-MKT-01): no ledger account, no money function, no reference to backings or balances
-- (apps/api/test/marketplace.test.ts reads this file and checks it). All access goes through the API (NFR-MKT-03).

-- ── Audience (FR-MKT-021) ───────────────────────────────────────────────
insert into public.platform_settings (key, value) values ('marketplace.audience', '"invited"') on conflict (key) do nothing;
create function public.marketplace_audience() returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' from public.platform_settings where key = 'marketplace.audience'), 'invited')
$$;

-- ── Invites (FR-MKT-022/023). Only the SHA-256 of the code is stored (NFR-MKT-08). ──
create table public.marketplace_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  email extensions.citext not null check (char_length(email::text) <= 200 and email::text like '%@%'),
  name text check (char_length(name) <= 80),
  kind text not null check (kind in ('provider', 'artist')),
  note text check (char_length(note) <= 500),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_by uuid references public.profiles (id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  check (redeemed_at is null or revoked_at is null)
);
-- One open (unredeemed, unrevoked) invite per email. Expired ones still count until revoked, so staff see them.
create unique index marketplace_invites_one_open on public.marketplace_invites (email) where redeemed_at is null and revoked_at is null;
create index marketplace_invites_created_idx on public.marketplace_invites (created_at desc);

-- ── Members (FR-MKT-023/027) ────────────────────────────────────────────
create table public.marketplace_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('provider', 'artist')),
  invite_id uuid references public.marketplace_invites (id) on delete set null,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create trigger marketplace_members_touch before update on public.marketplace_members for each row execute function public.touch_updated_at();

-- `/services/join` is a route now (FR-MKT-023), so `join` joins the reserved slugs (packages/shared RESERVED_SLUGS).
alter table public.service_providers drop constraint service_providers_slug_check;
alter table public.service_providers add constraint service_providers_slug_check
  check (slug ~ '^[a-z0-9-]{3,60}$' and slug::text not in ('requests', 'new', 'edit', 'provider', 'providers', 'search', 'join'));

-- ── Provider Terms acceptance (FR-MKT-025): a new kind in the append-only consents table ──
alter table public.consents drop constraint consents_kind_check;
alter table public.consents add constraint consents_kind_check check (kind in ('terms', 'privacy', 'adult_attestation', 'provider_terms'));

-- ── Access (NFR-MKT-03) ─────────────────────────────────────────────────
alter table public.marketplace_invites enable row level security;
alter table public.marketplace_members enable row level security;
revoke all on public.marketplace_invites, public.marketplace_members from public, anon, authenticated;
grant select, insert, update on public.marketplace_invites, public.marketplace_members to service_role;
revoke execute on function public.marketplace_audience() from public, anon, authenticated;
grant execute on function public.marketplace_audience() to service_role;
