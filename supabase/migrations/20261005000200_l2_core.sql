-- Layer 2 (CR-002) · core schema for album royalty Pools (Reg CF revenue share), demo on mock rails.
-- Design specs/l2/02-design.md §2–§4. Money is bigint cents. Every table: RLS on, no client grants (0500); reads and
-- writes go through the API (service role) with explicit owner/staff scoping, and money only through SQL functions.

-- ── Enums ──────────────────────────────────────────────────────────────
create type public.pool_status as enum (
  'draft', 'in_review', 'revisions_requested', 'approved', 'live', 'funded', 'failed', 'refunded', 'matured', 'withdrawn'
);
create type public.investment_status as enum (
  'reserved', 'funding', 'funded', 'issued', 'expired', 'cancelled', 'returned', 'refund_pending', 'refunded'
);
create type public.kyc_status as enum ('not_started', 'pending', 'approved', 'rejected', 'manual_review');
create type public.collection_mechanism as enum ('DISTRIBUTOR_REDIRECT', 'SPLIT_PAYEE', 'LOCKBOX', 'LETTER_OF_DIRECTION', 'SELF_REPORT');
create type public.risk_badge as enum ('SECURED_ISH', 'VERIFIED', 'TRUST_BASED');
create type public.collection_state as enum ('COLLECTING', 'AT_RISK', 'DEFAULT', 'REMEDIATION', 'CHARGED_OFF');
create type public.revenue_type as enum ('master', 'sync', 'publishing');

-- ── Errors: message = <rule code>, detail = <human sentence> (M1 convention) ──
create function public.l2_fail(p_code text, p_detail text) returns void language plpgsql set search_path = '' as $$
begin raise exception using errcode = 'P0001', message = p_code, detail = p_detail; end $$;

-- ── Flag (FR-PLT-001 slice; design §2). Off by default; local/CI seed turns it on. ──
insert into public.platform_settings (key, value) values ('flag.layer2', 'false');
create function public.l2_enabled() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = 'flag.layer2'), false)
$$;
create function public.l2_assert_enabled() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.l2_enabled() then perform public.l2_fail('layer2_disabled', 'Investing isn''t open.'); end if;
end $$;

-- ── Policy mirrors (packages/shared/src/policy.ts; a sync test keeps them equal) ──
insert into public.platform_settings (key, value) values
  ('regcf_limits', '{"floor_minor": 250000, "threshold_minor": 12400000, "low_bps": 500, "high_bps": 1000}'),
  ('l2_policy', '{"reserve_minutes": 30, "settle_grace_minutes": 10, "cancel_cutoff_hours": 48, "lockup_months": 12, "period_months": 3, "settlement_due_days": 45, "cure_days": 30, "blocked_states": [], "risk_ack_version": "2026-10-03-demo"}');
create function public.l2_policy(p_key text) returns jsonb language sql stable security definer set search_path = '' as $$
  select (select value from public.platform_settings where key = 'l2_policy') -> p_key
$$;

-- ── Issuers (the creator's offering entity at the provider) ──
create table public.issuers (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null unique references public.artists (id) on delete restrict,
  legal_name text not null check (char_length(legal_name) between 2 and 120),
  entity_type text not null default 'LLC' check (entity_type in ('LLC', 'Corporation')),
  provider_issuer_ref text unique,
  created_at timestamptz not null default now()
);

-- ── Pools ──────────────────────────────────────────────────────────────
create table public.pools (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists (id) on delete restrict,
  issuer_id uuid references public.issuers (id),
  slug extensions.citext not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  title text not null check (char_length(title) between 2 and 90),           -- album title
  artist_display text not null check (char_length(artist_display) between 1 and 80),
  genre text,
  release_date date,
  tracklist jsonb not null default '[]' check (jsonb_typeof(tracklist) = 'array' and jsonb_array_length(tracklist) <= 30),
  story text check (char_length(story) <= 20000),
  risks text check (char_length(risks) <= 5000),
  use_of_funds jsonb not null default '[]' check (jsonb_typeof(use_of_funds) = 'array' and jsonb_array_length(use_of_funds) <= 12),
  revenue_types public.revenue_type[] not null default '{master}' check (cardinality(revenue_types) between 1 and 3),
  fans_bps integer not null check (fans_bps between 100 and 9000),
  creator_bps integer not null check (creator_bps >= 0),
  platform_bps integer not null check (platform_bps between 0 and 2000),
  units_total integer not null check (units_total between 1 and 1000000),
  unit_price_minor bigint not null check (unit_price_minor between 100 and 100000000),
  min_units integer not null default 1 check (min_units >= 1),
  target_minor bigint not null check (target_minor >= 100000),               -- $1,000 minimum target
  max_minor bigint generated always as (units_total::bigint * unit_price_minor) stored,
  duration_days smallint not null default 30 check (duration_days between 14 and 60),
  return_cap_bps integer not null default 15000 check (return_cap_bps between 10000 and 30000),
  maturity_months integer not null default 60 check (maturity_months between 12 and 120),
  distribution_frequency text not null default 'quarterly' check (distribution_frequency in ('quarterly')),
  collection_mechanism public.collection_mechanism not null default 'DISTRIBUTOR_REDIRECT',
  risk_badge public.risk_badge,
  status public.pool_status not null default 'draft',
  collection_state public.collection_state not null default 'COLLECTING',
  collection_state_since timestamptz,
  tier_at_submission public.creator_tier,
  cap_minor_at_submission bigint,
  form_c_document_id uuid,
  provider_offering_ref text unique,
  provider_collection_ref text unique,
  -- Counters maintained only by the money functions.
  units_committed integer not null default 0 check (units_committed >= 0),
  units_issued integer not null default 0 check (units_issued >= 0),
  raised_minor bigint not null default 0 check (raised_minor >= 0),
  investors_count integer not null default 0 check (investors_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  settled_at timestamptz,
  closed_at timestamptz,
  matures_at timestamptz,
  matured_at timestamptz,
  matured_reason text check (matured_reason is null or matured_reason in ('cap_reached', 'maturity')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fans_bps + creator_bps + platform_bps = 10000),
  check (target_minor <= units_total::bigint * unit_price_minor),
  check (min_units <= units_total),
  check (units_committed <= units_total)
);
create index pools_artist_idx on public.pools (artist_id);
create index pools_status_ends_idx on public.pools (status, ends_at);
create trigger pools_touch before update on public.pools for each row execute function public.touch_updated_at();

create table public.pool_transitions (
  from_status public.pool_status not null,
  to_status public.pool_status not null,
  primary key (from_status, to_status)
);
insert into public.pool_transitions values
  ('draft','in_review'), ('draft','withdrawn'),
  ('in_review','revisions_requested'), ('in_review','approved'), ('in_review','withdrawn'),
  ('revisions_requested','in_review'), ('revisions_requested','withdrawn'),
  ('approved','live'), ('approved','withdrawn'),
  ('live','funded'), ('live','failed'),
  ('failed','refunded'),
  ('funded','matured');
create function public.enforce_pool_transition() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and not exists (select 1 from public.pool_transitions t where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'illegal pool transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger pools_transition before update of status on public.pools for each row execute function public.enforce_pool_transition();

-- Production milestones (M1 tranche rules, Pool-scoped).
create table public.pool_tranches (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  seq smallint not null check (seq between 1 and 3),
  pct smallint not null check (pct between 1 and 100),
  milestone text check (char_length(milestone) <= 200),
  evidence_required text check (char_length(evidence_required) <= 500),
  target_date date,
  status public.tranche_status not null default 'pending',
  released_minor bigint,
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  released_at timestamptz,
  unique (pool_id, seq)
);
create table public.pool_tranche_evidence (
  id uuid primary key default gen_random_uuid(),
  tranche_id uuid not null references public.pool_tranches (id),
  submitted_by uuid not null references public.profiles (id),
  notes text not null check (char_length(notes) between 10 and 4000),
  links text[] not null default '{}' check (cardinality(links) <= 10),
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now()
);
create trigger pool_tranche_evidence_no_change before update or delete on public.pool_tranche_evidence for each row execute function public.ledger_append_only();

create table public.pool_documents (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  kind text not null check (kind in ('form_c')),
  version integer not null,
  body jsonb not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (pool_id, kind, version)
);
create trigger pool_documents_no_change before update or delete on public.pool_documents for each row execute function public.ledger_append_only();
alter table public.pools add constraint pools_form_c_fk foreign key (form_c_document_id) references public.pool_documents (id);

create table public.pool_reviews (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  decision text not null check (decision in ('approved', 'revisions_requested')),
  notes text,
  form_c_sha256 text,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now()
);

-- Collection mechanism record (01b §1.1; AC-R6: executed before the Pool can go live).
create table public.collection_mechanisms (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null unique references public.pools (id) on delete cascade,
  mechanism public.collection_mechanism not null,
  revenue_types public.revenue_type[] not null,
  badge public.risk_badge not null,
  details jsonb not null default '{}',
  status text not null default 'submitted' check (status in ('submitted', 'executed', 'revoked')),
  submitted_at timestamptz not null default now(),
  executed_by uuid references public.profiles (id),
  executed_at timestamptz
);

-- ── Investors ──────────────────────────────────────────────────────────
-- Legal names and ID documents go to the provider only. Income / net worth are the investor's own attestation, kept
-- because the Reg CF limit depends on them (design §12): service-role only, never logged, never in audit payloads.
create table public.investor_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  kyc_status public.kyc_status not null default 'not_started',
  provider_party_ref text unique,
  provider_account_ref text unique,
  provider_link_ref text,
  state char(2) check (state ~ '^[A-Z]{2}$'),
  annual_income_minor bigint check (annual_income_minor >= 0),
  net_worth_minor bigint check (net_worth_minor >= 0),
  accredited boolean not null default false,
  elsewhere_12m_minor bigint not null default 0 check (elsewhere_12m_minor >= 0),
  certified_at timestamptz,
  kyc_updated_at timestamptz,
  kyc_decided_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger investor_profiles_touch before update on public.investor_profiles for each row execute function public.touch_updated_at();

create table public.investments (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete restrict,
  investor_id uuid not null references public.profiles (id) on delete restrict,
  units integer not null check (units > 0),
  unit_price_minor bigint not null check (unit_price_minor > 0),
  amount_minor bigint not null check (amount_minor > 0),
  cap_minor bigint not null check (cap_minor >= amount_minor),
  distributed_minor bigint not null default 0 check (distributed_minor >= 0),
  status public.investment_status not null default 'reserved',
  reserve_expires_at timestamptz,
  risk_ack_version text not null,
  risk_ack_at timestamptz not null default now(),
  provider_trade_ref text unique,
  provider_fund_ref text unique,
  funded_at timestamptz,
  issued_at timestamptz,
  lockup_ends_at timestamptz,
  cancelled_at timestamptz,
  refund_ref text,
  refunded_at timestamptz,
  status_reason text,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_minor = units::bigint * unit_price_minor),
  check (distributed_minor <= cap_minor)
);
create index investments_investor_idx on public.investments (investor_id, status, created_at);
create index investments_pool_idx on public.investments (pool_id, status);
create index investments_reserved_idx on public.investments (reserve_expires_at) where status = 'reserved';
create trigger investments_touch before update on public.investments for each row execute function public.touch_updated_at();

-- ── Ledger: a Pool dimension (design §3). M1 campaign kinds keep their campaign_id rule. ──
alter table public.ledger_accounts add column pool_id uuid references public.pools (id) on delete restrict;
alter table public.ledger_accounts drop constraint ledger_accounts_check;
alter table public.ledger_accounts add constraint ledger_accounts_dimension_check check (
  ((kind in ('escrow_cash', 'backer_liability', 'artist_payable')) = (campaign_id is not null))
  and ((kind::text like 'pool\_%') = (pool_id is not null))
);
drop index public.ledger_accounts_unique;
create unique index ledger_accounts_unique on public.ledger_accounts (
  kind, coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(pool_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.ledger_transactions
  add column pool_id uuid references public.pools (id),
  add column investment_id uuid references public.investments (id);
create index ledger_transactions_pool_idx on public.ledger_transactions (pool_id) where pool_id is not null;

create function public.pool_account(p_kind public.ledger_account_kind, p_pool uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.ledger_accounts where kind = p_kind and pool_id = p_pool;
  if v is null then
    insert into public.ledger_accounts (kind, pool_id) values (p_kind, p_pool) on conflict do nothing returning id into v;
    if v is null then select id into v from public.ledger_accounts where kind = p_kind and pool_id = p_pool; end if;
  end if;
  return v;
end $$;

-- Balanced, idempotent posting with the Pool dimension. p_entries: [{"kind": "...", "amount": bigint}, ...]
create function public.ledger_post_pool(p_kind text, p_idem text, p_pool uuid, p_entries jsonb,
  p_investment uuid default null, p_ref text default null, p_memo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tx uuid; e jsonb;
begin
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idem;
  if v_tx is not null then return v_tx; end if;
  insert into public.ledger_transactions (kind, idempotency_key, pool_id, investment_id, external_ref, memo)
  values (p_kind, p_idem, p_pool, p_investment, p_ref, p_memo) returning id into v_tx;
  for e in select * from jsonb_array_elements(p_entries) loop
    if (e ->> 'amount')::bigint <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, public.pool_account((e ->> 'kind')::public.ledger_account_kind, p_pool), (e ->> 'amount')::bigint);
    end if;
  end loop;
  return v_tx;
end $$;

create function public.pool_balance(p_kind public.ledger_account_kind, p_pool uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(e.amount_minor), 0)::bigint
    from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
   where a.kind = p_kind and a.pool_id = p_pool
$$;

-- Risk badge (design §8; mirrors packages/shared/src/l2.ts riskBadge — sync test).
create function public.l2_risk_badge(p_mechanism public.collection_mechanism, p_types public.revenue_type[])
returns public.risk_badge language sql immutable set search_path = '' as $$
  with m as (select case p_mechanism when 'DISTRIBUTOR_REDIRECT' then 3 when 'SPLIT_PAYEE' then 3 when 'LOCKBOX' then 2
                                     when 'LETTER_OF_DIRECTION' then 2 else 1 end as s),
       t as (select min(least((select s from m), case x when 'master' then 3 when 'sync' then 2 else 1 end)) as tier
               from unnest(case when cardinality(p_types) = 0 then '{master}'::public.revenue_type[] else p_types end) x)
  select case when tier >= 3 then 'SECURED_ISH' when tier = 2 then 'VERIFIED' else 'TRUST_BASED' end::public.risk_badge from t
$$;
