-- M1 · request context, provider event inbox, two-phase outbound operations, heartbeats, settings.
-- Design 02 §3.1–§3.3, §3.6; ADR-003, ADR-005.

-- ── Request context (ADR-005) ──────────────────────────────────────────
-- The API and worker set fanzup.* with set_config(…, true) at the start of every transaction.
create function public.ctx(p_key text) returns text language sql stable set search_path = '' as $$
  select nullif(current_setting('fanzup.' || p_key, true), '')
$$;

alter table public.audit_events
  add column correlation_id text default public.ctx('correlation_id'),
  add column actor_kind text not null default coalesce(public.ctx('actor_kind'), 'system:db'),
  add column aal text default public.ctx('aal');
create index audit_events_correlation_idx on public.audit_events (correlation_id) where correlation_id is not null;

-- actor_id: explicit values win; otherwise the request's verified actor (never client input).
create function public.audit_fill_actor() returns trigger language plpgsql set search_path = '' as $$
declare v text := public.ctx('actor_id');
begin
  if new.actor_id is null and v ~ '^[0-9a-f-]{36}$' then new.actor_id := v::uuid; end if;
  return new;
end $$;
create trigger audit_fill_actor before insert on public.audit_events for each row execute function public.audit_fill_actor();

alter table public.ledger_transactions add column correlation_id text default public.ctx('correlation_id');
create index ledger_transactions_correlation_idx on public.ledger_transactions (correlation_id) where correlation_id is not null;
create index ledger_transactions_ref_idx on public.ledger_transactions (external_ref) where external_ref is not null;
alter table public.outbox add column correlation_id text default public.ctx('correlation_id');

-- NFR-COMP-12: ledger and audit also reject TRUNCATE (row triggers don't see it).
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries for each statement execute function public.ledger_append_only();
create trigger ledger_tx_no_truncate before truncate on public.ledger_transactions for each statement execute function public.ledger_append_only();
create trigger audit_no_truncate before truncate on public.audit_events for each statement execute function public.ledger_append_only();

-- ── Backings: checkout context ─────────────────────────────────────────
alter table public.backings
  add column correlation_id text default public.ctx('correlation_id'),
  add column hold_expires_at timestamptz,
  add column source text check (source is null or source ~ '^[a-z0-9_-]{1,40}$'),
  -- amount actually captured by the provider (may differ from amount_minor on a mismatch; refunds use this)
  add column captured_minor bigint check (captured_minor is null or captured_minor > 0),
  -- perk units currently reserved for this backing (held at checkout start, returned on cancel/refund)
  add column units_held boolean not null default false,
  -- included in the campaign's public raised/backers counters
  add column counted boolean not null default false;
create index backings_open_holds_idx on public.backings (hold_expires_at) where status = 'pending_payment';

-- Claim-first idempotency (design §4.4).
alter table public.api_idempotency
  add column resource_id uuid,
  add column state text not null default 'done' check (state in ('in_progress', 'done'));

-- ── Provider event inbox (FR-PAY-002) ──────────────────────────────────
create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  type text not null,
  livemode boolean not null default false,
  account text,
  object_ref text,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'unmatched', 'failed', 'dead')),
  attempts integer not null default 0,
  last_error text,
  correlation_id text default public.ctx('correlation_id'),
  received_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);
create index provider_events_pending_idx on public.provider_events (next_attempt_at) where status in ('received', 'failed');
create index provider_events_object_idx on public.provider_events (provider, object_ref);

-- ── Two-phase outbound operations (FR-PAY-004) ─────────────────────────
create table public.outbound_ops (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'payout')),
  subject_id uuid not null,                       -- backing (refund) or tranche (payout)
  campaign_id uuid not null references public.campaigns (id),
  amount_minor bigint not null check (amount_minor > 0),
  idempotency_key text not null unique,
  reason text,
  status text not null default 'initiated' check (status in ('initiated', 'sent', 'confirmed', 'failed', 'dead')),
  waiting text,                                    -- e.g. 'funds', 'payout_account', 'recon_pause', 'earlier_tranche'
  provider_ref text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, subject_id)
);
create index outbound_ops_due_idx on public.outbound_ops (next_attempt_at) where status = 'initiated';
create trigger outbound_ops_touch before update on public.outbound_ops for each row execute function public.touch_updated_at();

-- ── Operations ─────────────────────────────────────────────────────────
create table public.worker_heartbeats (
  worker text primary key,
  beat_at timestamptz not null default now(),
  info jsonb not null default '{}'
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
-- FR-ID-007, card G1-A option 1: on until a second staff member exists (must be off before live money).
insert into public.platform_settings (key, value) values ('single_operator_mode', 'true');

alter table public.provider_events enable row level security;
alter table public.outbound_ops enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.platform_settings enable row level security;
revoke all on public.provider_events, public.outbound_ops, public.worker_heartbeats, public.platform_settings from anon, authenticated;
revoke execute on function public.ctx(text), public.audit_fill_actor() from public, anon, authenticated;
grant execute on function public.ctx(text) to service_role;

-- FR-ID-001 / FR-BCK-002: the API checks a verified email server-side. auth.users isn't readable by the API's
-- service role, so this narrow function answers the one question.
create function public.email_confirmed(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select email_confirmed_at is not null from auth.users where id = p_user), false)
$$;
revoke execute on function public.email_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.email_confirmed(uuid) to service_role;
