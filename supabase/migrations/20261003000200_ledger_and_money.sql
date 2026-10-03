-- Double-entry ledger + money operations (PRD 01a; Mechanism 05).
--
-- FanZuP never holds cash. The escrow partner does. This ledger is FanZuP's record of what
-- the partner holds and who it's owed to, and must reconcile to the partner's statements.
--
-- Sign convention: debit = positive, credit = negative. Every transaction sums to zero.
--
-- Accounts:
--   per campaign  escrow_cash        asset      mirror of funds held by the escrow partner
--                 backer_liability   liability  owed to backers until the campaign is funded
--                 artist_payable     liability  owed to the artist once funded, until released
--   global        processing_fees    clearing   processor fees (borne by the artist when funded)
--                 platform_funding   equity     FanZuP money used to make refunds whole
--                 platform_absorbed_fees expense fees FanZuP absorbs on refunds (see SETUP.md decision)

alter table public.campaigns add column duration_days smallint not null default 30 check (duration_days between 7 and 60);

create type public.ledger_account_kind as enum (
  'escrow_cash', 'backer_liability', 'artist_payable',
  'processing_fees', 'platform_funding', 'platform_absorbed_fees'
);

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind public.ledger_account_kind not null,
  campaign_id uuid references public.campaigns (id) on delete restrict,
  currency char(3) not null default 'usd',
  created_at timestamptz not null default now(),
  check ((kind in ('escrow_cash', 'backer_liability', 'artist_payable')) = (campaign_id is not null))
);
create unique index ledger_accounts_unique on public.ledger_accounts (kind, coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  idempotency_key text not null unique,
  campaign_id uuid references public.campaigns (id),
  backing_id uuid references public.backings (id),
  external_ref text,          -- processor / escrow partner reference
  memo text,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions (id),
  account_id uuid not null references public.ledger_accounts (id),
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now()
);
create index ledger_entries_account_idx on public.ledger_entries (account_id);
create index ledger_entries_tx_idx on public.ledger_entries (transaction_id);

-- Invariant 1: every transaction balances (checked at commit).
create function public.ledger_check_balanced() returns trigger language plpgsql as $$
declare s bigint;
begin
  select coalesce(sum(amount_minor), 0) into s from public.ledger_entries where transaction_id = new.transaction_id;
  if s <> 0 then
    raise exception 'ledger transaction % does not balance (sum=%)', new.transaction_id, s using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function public.ledger_check_balanced();

-- Invariant 2: append-only. Corrections are new reversing transactions, never edits.
create function public.ledger_append_only() returns trigger language plpgsql as $$
begin raise exception 'ledger is append-only (% on %)', tg_op, tg_table_name using errcode = 'insufficient_privilege'; end $$;
create trigger ledger_entries_no_change before update or delete on public.ledger_entries for each row execute function public.ledger_append_only();
create trigger ledger_tx_no_change before update or delete on public.ledger_transactions for each row execute function public.ledger_append_only();

create view public.ledger_balances with (security_invoker = true) as
  select a.id as account_id, a.kind, a.campaign_id, coalesce(sum(e.amount_minor), 0)::bigint as balance_minor
  from public.ledger_accounts a left join public.ledger_entries e on e.account_id = a.id
  group by a.id;

-- ── Audit + outbox ─────────────────────────────────────────────────────
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create trigger audit_no_change before update or delete on public.audit_events for each row execute function public.ledger_append_only();

-- Transactional outbox: written in the same transaction as the state change, drained by the API worker.
create table public.outbox (
  id bigint generated always as identity primary key,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz
);
create index outbox_pending_idx on public.outbox (available_at) where processed_at is null;

-- HTTP-level idempotency for the API (Idempotency-Key header, PRD 01a: ≥ 30 days).
create table public.api_idempotency (
  key text primary key,
  user_id uuid,
  request_hash text not null,
  response jsonb,
  status_code integer,
  created_at timestamptz not null default now()
);

-- ── Helpers ────────────────────────────────────────────────────────────
create function public.ledger_account(p_kind public.ledger_account_kind, p_campaign uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.ledger_accounts
   where kind = p_kind and coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_campaign, '00000000-0000-0000-0000-000000000000'::uuid);
  if v is null then
    insert into public.ledger_accounts (kind, campaign_id) values (p_kind, p_campaign)
    on conflict do nothing returning id into v;
    if v is null then
      select id into v from public.ledger_accounts
       where kind = p_kind and coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_campaign, '00000000-0000-0000-0000-000000000000'::uuid);
    end if;
  end if;
  return v;
end $$;

-- Posts a balanced transaction. Idempotent on p_idem: a repeat returns the original id and posts nothing.
-- p_entries: [{"account": uuid, "amount": bigint}, ...]
create function public.ledger_post(p_kind text, p_idem text, p_entries jsonb,
  p_campaign uuid default null, p_backing uuid default null, p_ref text default null, p_memo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tx uuid; e jsonb;
begin
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idem;
  if v_tx is not null then return v_tx; end if;
  insert into public.ledger_transactions (kind, idempotency_key, campaign_id, backing_id, external_ref, memo)
  values (p_kind, p_idem, p_campaign, p_backing, p_ref, p_memo) returning id into v_tx;
  for e in select * from jsonb_array_elements(p_entries) loop
    if (e ->> 'amount')::bigint <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_minor)
      values (v_tx, (e ->> 'account')::uuid, (e ->> 'amount')::bigint);
    end if;
  end loop;
  return v_tx;
end $$;

create function public.ledger_balance(p_account uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_minor), 0)::bigint from public.ledger_entries where account_id = p_account
$$;

-- ── Money operations (call from the API with the service role only) ────

-- 1. Processor confirmed a backer's payment. Funds are now with the escrow partner.
create function public.record_backing_captured(p_backing uuid, p_payment_ref text, p_fee_minor bigint, p_idem text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns; v_tx uuid; v_existing uuid;
begin
  select id into v_existing from public.ledger_transactions where idempotency_key = p_idem;
  if v_existing is not null then return v_existing; end if;

  select * into b from public.backings where id = p_backing for update;
  if not found then raise exception 'backing % not found', p_backing; end if;
  if b.status <> 'pending_payment' then raise exception 'backing % is %, expected pending_payment', p_backing, b.status; end if;
  select * into c from public.campaigns where id = b.campaign_id for update;
  if c.status <> 'live' or now() >= c.ends_at then raise exception 'campaign % is not accepting backings', c.id; end if;
  if p_fee_minor < 0 or p_fee_minor >= b.amount_minor then raise exception 'invalid processing fee'; end if;

  update public.perks set claimed = claimed + b.quantity where id = b.perk_id;  -- check constraint enforces the limit
  update public.backings set status = 'held', payment_ref = p_payment_ref, processing_fee_minor = p_fee_minor where id = b.id;
  update public.campaigns set raised_minor = raised_minor + b.amount_minor, backers_count = backers_count + 1 where id = c.id;
  insert into public.fulfillments (backing_id) values (b.id) on conflict do nothing;

  v_tx := public.ledger_post('backing.captured', p_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('escrow_cash', c.id), 'amount', b.amount_minor - p_fee_minor),
    jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', p_fee_minor),
    jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', -b.amount_minor)
  ), c.id, b.id, p_payment_ref, null);

  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (b.backer_id, 'backing.captured', 'backing', b.id, jsonb_build_object('amount_minor', b.amount_minor, 'fee_minor', p_fee_minor));
  return v_tx;
end $$;

-- 2. At the deadline: funded if the goal was reached, otherwise failed and every backer is queued for refund.
create function public.settle_campaign(p_campaign uuid, p_now timestamptz default now())
returns public.campaign_status language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; v_fees bigint; v_outcome public.campaign_status;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if c.status <> 'live' then return c.status; end if;                 -- idempotent: already settled
  if p_now < c.ends_at then raise exception 'campaign % has not reached its deadline', c.id; end if;

  if c.raised_minor >= c.goal_minor then
    v_outcome := 'funded';
    select coalesce(sum(processing_fee_minor), 0) into v_fees from public.backings where campaign_id = c.id and status = 'held';
    perform public.ledger_post('campaign.funded', 'campaign.funded:' || c.id, jsonb_build_array(
      jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', c.raised_minor),
      jsonb_build_object('account', public.ledger_account('artist_payable', c.id), 'amount', -c.raised_minor),
      -- Card processing is borne by the artist (products/fees.html; council D1 Q3).
      jsonb_build_object('account', public.ledger_account('artist_payable', c.id), 'amount', v_fees),
      jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', -v_fees)
    ), c.id, null, null, 'goal met');
    update public.backings set status = 'released' where campaign_id = c.id and status = 'held';
    -- Tranche 1 is released on funding (Mechanism 05 §2.4); it needs no milestone evidence.
    update public.campaign_tranches set status = 'verified', verified_at = p_now where campaign_id = c.id and seq = 1;
    insert into public.outbox (topic, payload) values ('campaign.funded', jsonb_build_object('campaign_id', c.id));
  else
    v_outcome := 'failed';
    insert into public.outbox (topic, payload)
      select 'backing.refund', jsonb_build_object('backing_id', b.id, 'payment_ref', b.payment_ref, 'amount_minor', b.amount_minor)
      from public.backings b where b.campaign_id = c.id and b.status = 'held';
    insert into public.outbox (topic, payload) values ('campaign.failed', jsonb_build_object('campaign_id', c.id));
  end if;

  update public.campaigns set status = v_outcome, settled_at = p_now where id = c.id;
  -- A failed campaign with nobody to refund is already fully refunded.
  if v_outcome = 'failed' and not exists (select 1 from public.backings where campaign_id = c.id and status = 'held') then
    update public.campaigns set status = 'refunded' where id = c.id;
  end if;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('campaign.settled', 'campaign', c.id, jsonb_build_object('outcome', v_outcome, 'raised_minor', c.raised_minor, 'goal_minor', c.goal_minor));
  return v_outcome;
end $$;

-- 3. Processor confirmed a refund for a failed campaign. Backers get the FULL amount back
--    (escrow promise); FanZuP covers the non-refundable processing fee.
create function public.record_backing_refunded(p_backing uuid, p_refund_ref text, p_idem text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns; v_tx uuid; v_existing uuid;
begin
  select id into v_existing from public.ledger_transactions where idempotency_key = p_idem;
  if v_existing is not null then return v_existing; end if;

  select * into b from public.backings where id = p_backing for update;
  if b.status <> 'held' then raise exception 'backing % is %, expected held', p_backing, b.status; end if;
  select * into c from public.campaigns where id = b.campaign_id for update;
  if c.status <> 'failed' then raise exception 'campaign % is %, refunds only for failed campaigns', c.id, c.status; end if;

  v_tx := public.ledger_post('backing.refunded', p_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', b.amount_minor),
    jsonb_build_object('account', public.ledger_account('escrow_cash', c.id), 'amount', -(b.amount_minor - b.processing_fee_minor)),
    jsonb_build_object('account', public.ledger_account('platform_funding'), 'amount', -b.processing_fee_minor),
    jsonb_build_object('account', public.ledger_account('platform_absorbed_fees'), 'amount', b.processing_fee_minor),
    jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', -b.processing_fee_minor)
  ), c.id, b.id, p_refund_ref, null);

  update public.backings set status = 'refunded', refund_ref = p_refund_ref where id = b.id;
  update public.perks set claimed = claimed - b.quantity where id = b.perk_id;
  if not exists (select 1 from public.backings where campaign_id = c.id and status = 'held') then
    update public.campaigns set status = 'refunded' where id = c.id;
  end if;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.refunded', 'backing', b.id, jsonb_build_object('amount_minor', b.amount_minor, 'refund_ref', p_refund_ref));
  return v_tx;
end $$;

-- 4. A reviewer verifies milestone evidence for tranche 2+.
create function public.verify_tranche(p_tranche uuid, p_reviewer uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.campaign_tranches set status = 'verified', verified_by = p_reviewer, verified_at = now()
   where id = p_tranche and status in ('pending', 'evidence_submitted');
  if not found then raise exception 'tranche % cannot be verified', p_tranche; end if;
  insert into public.audit_events (actor_id, action, entity, entity_id) values (p_reviewer, 'tranche.verified', 'tranche', p_tranche);
end $$;

-- How much a tranche releases: pct of net proceeds (raised − processing), capped at what's still owed.
-- The last tranche releases the full remainder so rounding never strands cents.
create function public.tranche_release_amount(p_tranche uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare t public.campaign_tranches; v_payable bigint; v_net bigint;
begin
  select * into t from public.campaign_tranches where id = p_tranche;
  v_payable := -public.ledger_balance(public.ledger_account('artist_payable', t.campaign_id));
  if not exists (select 1 from public.campaign_tranches where campaign_id = t.campaign_id and seq > t.seq) then
    return v_payable;
  end if;
  select c.raised_minor - coalesce((select sum(processing_fee_minor) from public.backings where campaign_id = c.id and status = 'released'), 0)
    into v_net from public.campaigns c where c.id = t.campaign_id;
  return least(v_payable, (v_net * t.pct) / 100);
end $$;

-- 5. Escrow partner confirmed a payout of a verified tranche to the artist.
--    The last tranche releases whatever remains, so rounding never strands cents.
create function public.record_tranche_released(p_tranche uuid, p_payout_ref text, p_idem text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare t public.campaign_tranches; c public.campaigns; v_amt bigint; v_existing uuid; v_last boolean;
begin
  select id into v_existing from public.ledger_transactions where idempotency_key = p_idem;
  if v_existing is not null then select released_minor into v_amt from public.campaign_tranches where id = p_tranche; return v_amt; end if;

  select * into t from public.campaign_tranches where id = p_tranche for update;
  if t.status <> 'verified' then raise exception 'tranche % is %, expected verified', p_tranche, t.status; end if;
  select * into c from public.campaigns where id = t.campaign_id for update;
  if c.status <> 'funded' then raise exception 'campaign % is %, expected funded', c.id, c.status; end if;
  if exists (select 1 from public.campaign_tranches where campaign_id = c.id and seq < t.seq and status <> 'released') then
    raise exception 'earlier tranches of campaign % are not released yet', c.id;
  end if;

  v_last := not exists (select 1 from public.campaign_tranches where campaign_id = c.id and seq > t.seq);
  v_amt := public.tranche_release_amount(t.id);

  perform public.ledger_post('tranche.released', p_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('artist_payable', c.id), 'amount', v_amt),
    jsonb_build_object('account', public.ledger_account('escrow_cash', c.id), 'amount', -v_amt)
  ), c.id, null, p_payout_ref, 'tranche ' || t.seq);

  update public.campaign_tranches set status = 'released', released_minor = v_amt, released_at = now() where id = t.id;
  if v_last then update public.campaigns set status = 'released' where id = c.id; end if;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('tranche.released', 'tranche', t.id, jsonb_build_object('amount_minor', v_amt, 'payout_ref', p_payout_ref));
  return v_amt;
end $$;

-- Campaigns without milestone release get a single 100% tranche on approval.
create function public.ensure_single_tranche(p_campaign uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.campaign_tranches (campaign_id, seq, pct)
  select p_campaign, 1, 100 where not exists (select 1 from public.campaign_tranches where campaign_id = p_campaign)
$$;
