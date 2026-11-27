-- Services marketplace, Phase MKT-1 (CR-005, specs/marketplace/02-design.md §2, ADR-010).
-- Directory + requests only. NO MONEY: no ledger account, no money function, no reference to backings or balances
-- (NFR-MKT-01; apps/api/test/marketplace.test.ts reads this file and checks it).
-- All access goes through the API (NFR-MKT-03): RLS on, nothing granted to anon/authenticated.

-- ── Flag (FR-MKT-001) ───────────────────────────────────────────────────
insert into public.platform_settings (key, value) values ('flag.marketplace', 'false') on conflict (key) do nothing;
create function public.marketplace_enabled() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = 'flag.marketplace'), false)
$$;

-- ── Categories (FR-MKT-002). Must match packages/shared/src/marketplace.ts (a test enforces this). ──
create function public.marketplace_categories() returns text[] language sql immutable set search_path = '' as $$
  select array['production', 'mixing_mastering', 'session_musicians', 'songwriting', 'video', 'photography', 'design',
               'marketing_pr', 'live_support', 'other']::text[]
$$;

-- ── Providers (FR-MKT-003) ──────────────────────────────────────────────
create table public.service_providers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  display_name text not null check (char_length(display_name) between 2 and 80),
  headline text not null check (char_length(headline) between 5 and 120),
  bio text check (char_length(bio) <= 2000),
  city text check (char_length(city) <= 80),
  remote_ok boolean not null default true,
  categories text[] not null check (cardinality(categories) between 1 and 5 and categories <@ public.marketplace_categories()),
  links text[] not null default '{}' check (cardinality(links) <= 5),
  contact_email text not null check (char_length(contact_email) <= 200 and contact_email like '%@%'),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'changes_requested', 'listed', 'suspended')),
  review_note text check (char_length(review_note) <= 1000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  listed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_providers_listed_idx on public.service_providers (listed_at desc) where status = 'listed';
create index service_providers_queue_idx on public.service_providers (submitted_at) where status = 'in_review';
create trigger service_providers_touch before update on public.service_providers for each row execute function public.touch_updated_at();

-- ── Listings (FR-MKT-004) ───────────────────────────────────────────────
create table public.service_listings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.service_providers (id) on delete cascade,
  position integer not null check (position between 0 and 9),
  category text not null check (category = any (public.marketplace_categories())),
  title text not null check (char_length(title) between 3 and 90),
  description text check (char_length(description) <= 2000),
  -- A "starting at" guide shown to artists. Never charged (ADR-010).
  price_from_minor bigint check (price_from_minor between 0 and 10000000),
  price_unit text not null default 'project' check (price_unit in ('project', 'song', 'hour', 'day')),
  turnaround_days integer check (turnaround_days between 1 and 365),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index service_listings_provider_idx on public.service_listings (provider_id, position);

-- ── Requests (FR-MKT-007/009/010) ───────────────────────────────────────
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  -- Listings are replaced wholesale, so a request keeps its own copy of the listing it was about.
  listing_id uuid references public.service_listings (id) on delete set null,
  listing_title text not null,
  listing_category text not null,
  provider_id uuid not null references public.service_providers (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  brief text not null check (char_length(brief) between 20 and 4000),
  budget_minor bigint check (budget_minor between 0 and 10000000),
  needed_by date,
  share_email boolean not null,
  -- Snapshot of the requester's account email, only when they chose to share it (NFR-MKT-04).
  requester_email text check (share_email or requester_email is null),
  status text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'withdrawn')),
  provider_note text check (char_length(provider_note) <= 1000),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open request per artist per listing (FR-MKT-007).
create unique index service_requests_one_open on public.service_requests (artist_id, listing_id) where status = 'sent';
create index service_requests_provider_idx on public.service_requests (provider_id, created_at desc);
create index service_requests_requester_idx on public.service_requests (requester_id, created_at desc);
create trigger service_requests_touch before update on public.service_requests for each row execute function public.touch_updated_at();

-- ── Access (NFR-MKT-03) ─────────────────────────────────────────────────
alter table public.service_providers enable row level security;
alter table public.service_listings enable row level security;
alter table public.service_requests enable row level security;
revoke all on public.service_providers, public.service_listings, public.service_requests from public, anon, authenticated;
revoke execute on function public.marketplace_enabled() from public, anon, authenticated;
grant execute on function public.marketplace_enabled() to service_role;
grant select, insert, update, delete on public.service_providers, public.service_listings, public.service_requests to service_role;

-- The requester's account email, read only to snapshot it on a request they chose to share it with (FR-MKT-007,
-- NFR-MKT-04). The service role can't read auth.users directly; this returns one address for one user id.
create function public.marketplace_requester_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select email from auth.users where id = p_user
$$;
revoke execute on function public.marketplace_requester_email(uuid) from public, anon, authenticated;
grant execute on function public.marketplace_requester_email(uuid) to service_role;
revoke execute on function public.marketplace_categories() from public, anon, authenticated;
grant execute on function public.marketplace_categories() to service_role;
