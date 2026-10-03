-- FanZuP core schema · Layer 1 (reward campaigns, Mechanism 05 "Fund My Show")
-- Money is bigint cents everywhere (PRD 01a). Layer 2 (Reg CF) tables come in a later migration.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- ── Enums ──────────────────────────────────────────────────────────────
create type public.creator_tier as enum ('Starter', 'Rising', 'Established', 'Pro');
create type public.verification_status as enum ('todo', 'pending', 'verified', 'rejected');
create type public.campaign_type as enum ('Show', 'Tour', 'Album', 'Music Video', 'Documentary');
-- Must match packages/shared/src/campaign.ts (a test enforces this).
create type public.campaign_status as enum (
  'draft', 'in_review', 'revisions_requested', 'approved', 'live',
  'funded', 'failed', 'released', 'refunded', 'closed', 'withdrawn'
);
create type public.perk_kind as enum ('digital', 'physical', 'experience');
create type public.backing_status as enum ('pending_payment', 'held', 'released', 'refunded', 'payment_failed', 'canceled');
create type public.tranche_status as enum ('pending', 'evidence_submitted', 'verified', 'released', 'rejected');
create type public.fulfillment_status as enum ('Preparing', 'Scheduled', 'Shipped', 'Delivered', 'Problem');

-- ── Reference data mirrored from packages/shared (tests keep them in sync) ──
create table public.tier_limits (
  tier public.creator_tier primary key,
  campaign_cap_minor bigint not null check (campaign_cap_minor > 0),
  reg_cf_cap_minor bigint
);
insert into public.tier_limits values
  ('Starter',     1000000,   null),
  ('Rising',      10000000,  10000000),
  ('Established', 10000000,  100000000),
  ('Pro',         10000000,  500000000);

create table public.campaign_transitions (
  from_status public.campaign_status not null,
  to_status public.campaign_status not null,
  primary key (from_status, to_status)
);
insert into public.campaign_transitions values
  ('draft','in_review'), ('draft','withdrawn'),
  ('in_review','revisions_requested'), ('in_review','approved'), ('in_review','withdrawn'),
  ('revisions_requested','in_review'), ('revisions_requested','withdrawn'),
  ('approved','live'), ('approved','withdrawn'),
  ('live','funded'), ('live','failed'),
  ('funded','released'), ('failed','refunded'),
  ('released','closed'), ('refunded','closed');

-- ── People ─────────────────────────────────────────────────────────────
-- Public profile only. Never store PII (DOB, address, TIN, ID docs) here — those live
-- with the identity/tax vendors and are referenced by token (PRD 01 §9.5).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null default '',
  city text,
  bio text check (char_length(bio) <= 500),
  created_at timestamptz not null default now()
);

create table public.artists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null check (char_length(name) between 1 and 80),
  genre text,
  city text,
  bio text check (char_length(bio) <= 500),
  tier public.creator_tier not null default 'Starter',
  identity_status public.verification_status not null default 'todo',
  identity_ref text,              -- vendor inquiry id (Persona/Plaid), never the documents
  phone_verified boolean not null default false,
  monthly_listeners integer not null default 0 check (monthly_listeners >= 0),
  streaming_history_months integer not null default 0 check (streaming_history_months >= 0),
  ein_verified boolean not null default false,
  business_bank_verified boolean not null default false,
  payout_account_ref text,         -- processor connected-account id (e.g. Stripe acct_…)
  created_at timestamptz not null default now()
);
create index artists_owner_idx on public.artists (owner_id);

-- ── Campaigns ──────────────────────────────────────────────────────────
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete restrict,
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  title text not null check (char_length(title) between 3 and 90),
  type public.campaign_type not null,
  blurb text check (char_length(blurb) <= 160),
  story text,
  risks text,
  goal_minor bigint not null check (goal_minor >= 50000),        -- $500 minimum
  currency char(3) not null default 'usd',
  status public.campaign_status not null default 'draft',
  milestone_release boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  -- Tier is assessed at campaign creation/submission, not mid-campaign (PRD 01 §6.3).
  tier_at_submission public.creator_tier,
  cap_minor_at_submission bigint,
  -- Counters maintained only by the money functions below (clients can't write them).
  raised_minor bigint not null default 0 check (raised_minor >= 0),
  backers_count integer not null default 0 check (backers_count >= 0),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (cap_minor_at_submission is null or goal_minor <= cap_minor_at_submission)
);
create index campaigns_artist_idx on public.campaigns (artist_id);
create index campaigns_status_ends_idx on public.campaigns (status, ends_at);

create table public.campaign_tranches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  seq smallint not null check (seq between 1 and 3),
  pct smallint not null check (pct between 1 and 100),
  milestone text,                       -- null for tranche 1 (released on funding)
  evidence_required text,
  target_date date,
  status public.tranche_status not null default 'pending',
  released_minor bigint,
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  released_at timestamptz,
  unique (campaign_id, seq)
);

create table public.perks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  description text,
  kind public.perk_kind not null,
  price_minor bigint not null check (price_minor >= 100),
  quantity_limit integer check (quantity_limit is null or quantity_limit > 0),
  claimed integer not null default 0 check (claimed >= 0),
  fulfill_by date not null,
  ships_to text check (ships_to in ('us', 'na', 'world')),
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  check (quantity_limit is null or claimed <= quantity_limit)
);
create index perks_campaign_idx on public.perks (campaign_id);

-- ── Backings ───────────────────────────────────────────────────────────
create table public.backings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  perk_id uuid not null references public.perks (id) on delete restrict,
  backer_id uuid not null references public.profiles (id) on delete restrict,
  quantity smallint not null default 1 check (quantity between 1 and 10),
  amount_minor bigint not null check (amount_minor > 0),
  processing_fee_minor bigint not null default 0 check (processing_fee_minor >= 0),
  status public.backing_status not null default 'pending_payment',
  payment_ref text unique,              -- processor PaymentIntent id
  refund_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index backings_campaign_idx on public.backings (campaign_id, status);
create index backings_backer_idx on public.backings (backer_id);

create table public.fulfillments (
  backing_id uuid primary key references public.backings (id) on delete cascade,
  status public.fulfillment_status not null default 'Preparing',
  tracking text,
  note text,
  updated_at timestamptz not null default now()
);

create table public.campaign_reviews (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  decision text not null check (decision in ('approved', 'revisions_requested')),
  checklist jsonb not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

-- Staff roles (compliance reviewers). Granted by service role only.
create table public.staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('reviewer', 'admin')),
  created_at timestamptz not null default now()
);

-- ── Housekeeping triggers ──────────────────────────────────────────────
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger campaigns_touch before update on public.campaigns for each row execute function public.touch_updated_at();
create trigger backings_touch before update on public.backings for each row execute function public.touch_updated_at();

-- New auth user → public profile.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Campaign status may only move along campaign_transitions.
create function public.enforce_campaign_transition() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and not exists (select 1 from public.campaign_transitions t where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'illegal campaign transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger campaigns_transition before update of status on public.campaigns
  for each row execute function public.enforce_campaign_transition();
