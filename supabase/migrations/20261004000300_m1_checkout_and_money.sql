-- M1 · checkout holds, captures (incl. late/mismatched), refunds, tranche evidence and releases, reconciliation tables.
-- Design 02 §3.4, §3.5, §3.6 (recon), §7. All money functions: security definer, empty search_path, service_role only.
-- Errors our API maps to HTTP codes are raised as: message = <code>, detail = <human sentence>.

-- ── Helpers ────────────────────────────────────────────────────────────
-- Public counters: distinct backers whose backing is counted (FR-PAY-009: backing twice counts once).
create function public.recount_backers(p_campaign uuid) returns void
language sql security definer set search_path = '' as $$
  update public.campaigns c
     set backers_count = (select count(distinct b.backer_id) from public.backings b where b.campaign_id = c.id and b.counted)
   where c.id = p_campaign
$$;

-- ── Checkout hold (FR-PAY-001, FR-PAY-006, FR-TAX-004 cap) ─────────────
create function public.create_backing_hold(
  p_user uuid, p_campaign uuid, p_perk uuid, p_qty integer, p_source text, p_hold_minutes integer, p_max_open integer)
returns table (backing_id uuid, amount_minor bigint, hold_expires_at timestamptz, description text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare c record; v_price bigint; v_title text; v_open integer; v_id uuid; v_exp timestamptz;
begin
  if p_qty < 1 or p_qty > 10 then
    raise exception using errcode = 'P0001', message = 'invalid_quantity', detail = 'Choose a quantity between 1 and 10.';
  end if;
  -- Serialise one fan's checkouts so the open-checkout cap holds under concurrency.
  perform 1 from public.profiles where id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_not_found', detail = 'Your account isn''t set up yet. Sign out and back in.';
  end if;
  select cm.id, cm.status, cm.ends_at, cm.title, a.owner_id into c
    from public.campaigns cm join public.artists a on a.id = cm.artist_id
   where cm.id = p_campaign;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found', detail = 'We couldn''t find that campaign.';
  end if;
  if c.status <> 'live' or c.ends_at is null or now() >= c.ends_at then
    raise exception using errcode = 'P0001', message = 'campaign_closed', detail = 'This campaign isn''t accepting backers right now.';
  end if;
  -- Market integrity (PRD 03 FR-MKT; council D1 condition 3).
  if c.owner_id = p_user then
    raise exception using errcode = 'P0001', message = 'self_backing', detail = 'You can''t back your own campaign.';
  end if;
  select count(*) into v_open from public.backings b
   where b.backer_id = p_user and b.status = 'pending_payment' and b.hold_expires_at > now();
  if v_open >= p_max_open then
    raise exception using errcode = 'P0001', message = 'too_many_open_checkouts',
      detail = 'You have other checkouts open. Finish them or wait a few minutes for them to expire, then try again.';
  end if;
  -- Hold the units now. The row lock serialises racing fans; the loser re-checks the limit and finds it full.
  update public.perks p set claimed = p.claimed + p_qty
   where p.id = p_perk and p.campaign_id = p_campaign
     and (p.quantity_limit is null or p.claimed + p_qty <= p.quantity_limit)
  returning p.price_minor, p.title into v_price, v_title;
  if not found then
    if exists (select 1 from public.perks where id = p_perk and campaign_id = p_campaign) then
      raise exception using errcode = 'P0001', message = 'perk_sold_out', detail = 'That perk just sold out.';
    end if;
    raise exception using errcode = 'P0001', message = 'perk_not_found', detail = 'That perk isn''t part of this campaign.';
  end if;
  v_exp := now() + make_interval(mins => p_hold_minutes);
  insert into public.backings (campaign_id, perk_id, backer_id, quantity, amount_minor, status, hold_expires_at, source, units_held)
  values (p_campaign, p_perk, p_user, p_qty, v_price * p_qty, 'pending_payment', v_exp, p_source, true)
  returning id into v_id;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'backing.hold_created', 'backing', v_id,
          jsonb_build_object('perk_id', p_perk, 'quantity', p_qty, 'amount_minor', v_price * p_qty, 'hold_expires_at', v_exp));
  return query select v_id, v_price * p_qty, v_exp, c.title || ' — ' || v_title;
end $$;

-- Hold expired or the deadline passed: give the units back. Called only after the provider confirms the
-- payment attempt can no longer succeed (cancelled), or when no payment attempt was ever created.
create function public.release_backing_hold(p_backing uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare b public.backings;
begin
  select * into b from public.backings where id = p_backing for update;
  if not found or b.status <> 'pending_payment' then return false; end if;
  if b.units_held then update public.perks set claimed = claimed - b.quantity where id = b.perk_id; end if;
  update public.backings set status = 'canceled', units_held = false, hold_expires_at = null where id = b.id;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.hold_released', 'backing', b.id, jsonb_build_object('reason', p_reason));
  return true;
end $$;

-- ── Capture (FR-PAY-003) ───────────────────────────────────────────────
-- Applies a confirmed payment. Anything the platform can't accept (hold expired, campaign closed, amount or
-- currency differs) is still recorded — money in — and a full refund is queued — money out.
-- Returns 'applied', 'duplicate', or 'refund:<reason>'.
create function public.apply_payment_captured(
  p_backing uuid, p_payment_ref text, p_amount bigint, p_currency text, p_fee bigint, p_idem text)
returns text language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns; v_reason text; v_new_backer boolean;
begin
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  select * into b from public.backings where id = p_backing for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'backing_not_found', detail = 'No backing for this payment.';
  end if;
  select * into c from public.campaigns where id = b.campaign_id for update;
  if p_amount <= 0 or p_fee < 0 or p_fee >= p_amount then
    raise exception using errcode = 'P0001', message = 'invalid_capture', detail = 'Captured amount or fee is invalid.';
  end if;

  v_reason := case
    when b.status = 'canceled' then 'hold_expired'
    when b.status <> 'pending_payment' then 'unexpected_state_' || b.status::text
    when c.status <> 'live' or now() >= c.ends_at then 'campaign_closed'
    when p_amount <> b.amount_minor or lower(p_currency) <> c.currency then 'amount_mismatch'
    else null end;

  if v_reason is null then
    v_new_backer := not exists (select 1 from public.backings x where x.campaign_id = c.id and x.backer_id = b.backer_id and x.counted and x.id <> b.id);
    update public.backings
       set status = 'held', payment_ref = p_payment_ref, processing_fee_minor = p_fee, captured_minor = p_amount,
           hold_expires_at = null, counted = true
     where id = b.id;
    update public.campaigns
       set raised_minor = raised_minor + p_amount, backers_count = backers_count + case when v_new_backer then 1 else 0 end
     where id = c.id;
    insert into public.fulfillments (backing_id) values (b.id) on conflict do nothing;
    perform public.ledger_post('backing.captured', p_idem, jsonb_build_array(
      jsonb_build_object('account', public.ledger_account('escrow_cash', c.id), 'amount', p_amount - p_fee),
      jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', p_fee),
      jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', -p_amount)
    ), c.id, b.id, p_payment_ref, null);
    insert into public.outbox (topic, payload) values ('notify.backing_receipt', jsonb_build_object('backing_id', b.id));
    insert into public.audit_events (action, entity, entity_id, data)
    values ('backing.captured', 'backing', b.id, jsonb_build_object('amount_minor', p_amount, 'fee_minor', p_fee));
    return 'applied';
  end if;

  -- Not applicable: record the money in, owe it back to the backer, queue the full refund.
  if b.units_held and b.status = 'pending_payment' then
    update public.perks set claimed = claimed - b.quantity where id = b.perk_id;
  end if;
  update public.backings
     set status = 'refund_pending', payment_ref = coalesce(payment_ref, p_payment_ref), processing_fee_minor = p_fee,
         captured_minor = p_amount, hold_expires_at = null,
         units_held = case when b.status = 'pending_payment' then false else units_held end
   where id = b.id;
  perform public.ledger_post('backing.captured_unapplied', p_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('escrow_cash', c.id), 'amount', p_amount - p_fee),
    jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', p_fee),
    jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', -p_amount)
  ), c.id, b.id, p_payment_ref, v_reason);
  insert into public.outbox (topic, payload) values
    ('backing.refund', jsonb_build_object('backing_id', b.id, 'reason', v_reason)),
    ('notify.refund_started', jsonb_build_object('backing_id', b.id, 'reason', v_reason));
  if v_reason = 'amount_mismatch' then
    insert into public.recon_breaks (dedupe_key, kind, campaign_id, amount_minor, refs)
    values ('amount_mismatch:' || p_payment_ref, 'amount_mismatch', c.id, p_amount - b.amount_minor,
            jsonb_build_object('payment_ref', p_payment_ref, 'backing_id', b.id, 'expected_minor', b.amount_minor, 'captured_minor', p_amount))
    on conflict do nothing;
  end if;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.capture_unapplied', 'backing', b.id, jsonb_build_object('reason', v_reason, 'amount_minor', p_amount, 'fee_minor', p_fee));
  return 'refund:' || v_reason;
end $$;

-- ── Refunds ────────────────────────────────────────────────────────────
-- Staff refund of one backing (FR-DSP-001 M1 slice): held backing on a live or failed campaign.
create function public.request_backing_refund(p_backing uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns;
begin
  select * into b from public.backings where id = p_backing for update;
  if not found then raise exception using errcode = 'P0001', message = 'backing_not_found', detail = 'No such backing.'; end if;
  select * into c from public.campaigns where id = b.campaign_id for update;
  if b.status <> 'held' or c.status not in ('live', 'failed') then
    raise exception using errcode = 'P0001', message = 'refund_not_available',
      detail = 'Only a backing held on a live or failed campaign can be refunded in M1.';
  end if;
  if b.counted then
    update public.campaigns set raised_minor = raised_minor - b.captured_minor where id = c.id;
  end if;
  update public.backings set status = 'refund_pending', counted = false where id = b.id;
  perform public.recount_backers(c.id);
  insert into public.outbox (topic, payload) values
    ('backing.refund', jsonb_build_object('backing_id', b.id, 'reason', 'staff_refund')),
    ('notify.refund_started', jsonb_build_object('backing_id', b.id, 'reason', 'staff_refund'));
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.refund_requested', 'backing', b.id, jsonb_build_object('reason', p_reason));
end $$;

-- Provider confirmed a refund. One function for every refund path. Backers get the FULL captured amount back;
-- FanZuP absorbs the non-refundable processing fee (E1 card C default until Wayne decides it).
create function public.record_refund_confirmed(p_backing uuid, p_refund_ref text, p_amount bigint, p_idem text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns; v_tx uuid;
begin
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idem;
  if v_tx is not null then return v_tx; end if;
  select * into b from public.backings where id = p_backing for update;
  if not found then raise exception using errcode = 'P0001', message = 'backing_not_found', detail = 'No such backing.'; end if;
  select * into c from public.campaigns where id = b.campaign_id for update;
  if b.status not in ('held', 'refund_pending') then
    raise exception using errcode = 'P0001', message = 'refund_state', detail = format('Backing is %s; nothing to refund.', b.status);
  end if;
  if p_amount <> b.captured_minor then
    raise exception using errcode = 'P0001', message = 'refund_amount_mismatch',
      detail = format('Provider refunded %s, captured was %s.', p_amount, b.captured_minor);
  end if;

  v_tx := public.ledger_post('backing.refunded', p_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', b.captured_minor),
    jsonb_build_object('account', public.ledger_account('escrow_cash', c.id), 'amount', -(b.captured_minor - b.processing_fee_minor)),
    jsonb_build_object('account', public.ledger_account('platform_funding'), 'amount', -b.processing_fee_minor),
    jsonb_build_object('account', public.ledger_account('platform_absorbed_fees'), 'amount', b.processing_fee_minor),
    jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', -b.processing_fee_minor)
  ), c.id, b.id, p_refund_ref, null);

  if b.counted then
    update public.campaigns set raised_minor = raised_minor - b.captured_minor where id = c.id;
  end if;
  if b.units_held then update public.perks set claimed = claimed - b.quantity where id = b.perk_id; end if;
  update public.backings set status = 'refunded', refund_ref = p_refund_ref, counted = false, units_held = false where id = b.id;
  perform public.recount_backers(c.id);
  if c.status = 'failed' and not exists (
       select 1 from public.backings where campaign_id = c.id and status in ('held', 'refund_pending')) then
    update public.campaigns set status = 'refunded' where id = c.id;
  end if;
  insert into public.outbox (topic, payload) values ('notify.refund_completed', jsonb_build_object('backing_id', b.id));
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.refunded', 'backing', b.id, jsonb_build_object('amount_minor', b.captured_minor, 'refund_ref', p_refund_ref));
  return v_tx;
end $$;

-- Every refund now goes through record_refund_confirmed.
drop function public.record_backing_refunded(uuid, text, text);

-- ── Settlement (refunds and releases flow through outbound_ops) ────────
create or replace function public.settle_campaign(p_campaign uuid, p_now timestamptz default now())
returns public.campaign_status language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; v_fees bigint; v_outcome public.campaign_status; v_t1 uuid;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then raise exception using errcode = 'P0001', message = 'campaign_not_found', detail = 'No such campaign.'; end if;
  if c.status <> 'live' then return c.status; end if;                 -- idempotent: already settled
  if p_now < c.ends_at then raise exception 'campaign % has not reached its deadline', c.id; end if;

  if c.raised_minor >= c.goal_minor then
    v_outcome := 'funded';
    select coalesce(sum(processing_fee_minor), 0) into v_fees from public.backings where campaign_id = c.id and status = 'held' and counted;
    perform public.ledger_post('campaign.funded', 'campaign.funded:' || c.id, jsonb_build_array(
      jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', c.raised_minor),
      jsonb_build_object('account', public.ledger_account('artist_payable', c.id), 'amount', -c.raised_minor),
      -- Card processing is borne by the artist (products/fees.html; council D1 Q3).
      jsonb_build_object('account', public.ledger_account('artist_payable', c.id), 'amount', v_fees),
      jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', -v_fees)
    ), c.id, null, null, 'goal met');
    update public.backings set status = 'released' where campaign_id = c.id and status = 'held';
    -- Tranche 1 is released on funding (Mechanism 05 §2.4); it needs no milestone evidence.
    update public.campaign_tranches set status = 'verified', verified_at = p_now
     where campaign_id = c.id and seq = 1 returning id into v_t1;
    insert into public.outbox (topic, payload) values ('campaign.funded', jsonb_build_object('campaign_id', c.id));
    if v_t1 is not null then
      insert into public.outbox (topic, payload) values ('tranche.release', jsonb_build_object('tranche_id', v_t1));
    end if;
  else
    v_outcome := 'failed';
    insert into public.outbox (topic, payload)
      select 'backing.refund', jsonb_build_object('backing_id', b.id, 'reason', 'campaign_failed')
      from public.backings b where b.campaign_id = c.id and b.status = 'held';
    insert into public.outbox (topic, payload) values ('campaign.failed', jsonb_build_object('campaign_id', c.id));
  end if;

  update public.campaigns set status = v_outcome, settled_at = p_now where id = c.id;
  if v_outcome = 'failed' and not exists (
       select 1 from public.backings where campaign_id = c.id and status in ('held', 'refund_pending')) then
    update public.campaigns set status = 'refunded' where id = c.id;
  end if;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('campaign.settled', 'campaign', c.id, jsonb_build_object('outcome', v_outcome, 'raised_minor', c.raised_minor, 'goal_minor', c.goal_minor));
  return v_outcome;
end $$;

-- ── Milestone evidence and verification (FR-PAY-005) ───────────────────
create table public.tranche_evidence (
  id uuid primary key default gen_random_uuid(),
  tranche_id uuid not null references public.campaign_tranches (id),
  submitted_by uuid not null references public.profiles (id),
  notes text not null check (char_length(notes) between 10 and 4000),
  links text[] not null default '{}' check (cardinality(links) <= 10),
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now()
);
create trigger tranche_evidence_no_change before update or delete on public.tranche_evidence for each row execute function public.ledger_append_only();
alter table public.tranche_evidence enable row level security;
revoke all on public.tranche_evidence from anon, authenticated;

create function public.submit_tranche_evidence(p_tranche uuid, p_user uuid, p_notes text, p_links text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t record; v_id uuid;
begin
  select tr.id, tr.seq, tr.status, c.id as campaign_id, c.status as campaign_status, a.owner_id into t
    from public.campaign_tranches tr join public.campaigns c on c.id = tr.campaign_id join public.artists a on a.id = c.artist_id
   where tr.id = p_tranche for update of tr;
  if not found or t.owner_id <> p_user then
    raise exception using errcode = 'P0001', message = 'tranche_not_found', detail = 'We couldn''t find that milestone.';
  end if;
  if t.campaign_status <> 'funded' or t.seq = 1 or t.status not in ('pending', 'evidence_submitted') then
    raise exception using errcode = 'P0001', message = 'evidence_not_accepted',
      detail = 'Evidence can be added to a later milestone of a funded campaign before it is verified.';
  end if;
  insert into public.tranche_evidence (tranche_id, submitted_by, notes, links) values (p_tranche, p_user, p_notes, coalesce(p_links, '{}'))
  returning id into v_id;
  update public.campaign_tranches set status = 'evidence_submitted' where id = p_tranche;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'tranche.evidence_submitted', 'tranche', p_tranche, jsonb_build_object('evidence_id', v_id));
  return v_id;
end $$;

-- Verification: reviewer must not own the campaign (FR-ID-003); later tranches need evidence; release is queued
-- automatically (the two-person control sits on verification, not release — FR-PAY-005).
create or replace function public.verify_tranche(p_tranche uuid, p_reviewer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select tr.id, tr.seq, tr.status, c.status as campaign_status, a.owner_id into t
    from public.campaign_tranches tr join public.campaigns c on c.id = tr.campaign_id join public.artists a on a.id = c.artist_id
   where tr.id = p_tranche for update of tr;
  if not found then raise exception using errcode = 'P0001', message = 'tranche_not_found', detail = 'No such milestone.'; end if;
  if t.owner_id = p_reviewer then
    raise exception using errcode = 'P0001', message = 'reviewer_is_owner', detail = 'You can''t verify a campaign you own.';
  end if;
  if t.campaign_status <> 'funded' then
    raise exception using errcode = 'P0001', message = 'campaign_not_funded', detail = 'Only a funded campaign''s milestones can be verified.';
  end if;
  if t.status <> 'evidence_submitted' then
    raise exception using errcode = 'P0001', message = 'evidence_required', detail = 'This milestone has no evidence waiting for verification.';
  end if;
  update public.campaign_tranches set status = 'verified', verified_by = p_reviewer, verified_at = now() where id = p_tranche;
  insert into public.outbox (topic, payload) values ('tranche.release', jsonb_build_object('tranche_id', p_tranche));
  insert into public.audit_events (actor_id, action, entity, entity_id) values (p_reviewer, 'tranche.verified', 'tranche', p_tranche);
end $$;

-- Payout confirmed: post exactly the amount the provider moved, which must equal what the rules say is owed.
drop function public.record_tranche_released(uuid, text, text);
create function public.record_tranche_released(p_tranche uuid, p_payout_ref text, p_amount bigint, p_idem text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare t public.campaign_tranches; c public.campaigns; v_amt bigint; v_last boolean;
begin
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then
    select released_minor into v_amt from public.campaign_tranches where id = p_tranche; return v_amt;
  end if;
  select * into t from public.campaign_tranches where id = p_tranche for update;
  if t.status <> 'verified' then raise exception 'tranche % is %, expected verified', p_tranche, t.status; end if;
  select * into c from public.campaigns where id = t.campaign_id for update;
  if c.status <> 'funded' then raise exception 'campaign % is %, expected funded', c.id, c.status; end if;
  if exists (select 1 from public.campaign_tranches where campaign_id = c.id and seq < t.seq and status <> 'released') then
    raise exception using errcode = 'P0001', message = 'earlier_tranche_pending', detail = 'Earlier milestones must be released first.';
  end if;
  v_amt := public.tranche_release_amount(t.id);
  if v_amt <> p_amount then
    raise exception using errcode = 'P0001', message = 'payout_amount_mismatch', detail = format('Provider paid %s, owed %s.', p_amount, v_amt);
  end if;
  v_last := not exists (select 1 from public.campaign_tranches where campaign_id = c.id and seq > t.seq);
  perform public.ledger_post('tranche.released', p_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('artist_payable', c.id), 'amount', v_amt),
    jsonb_build_object('account', public.ledger_account('escrow_cash', c.id), 'amount', -v_amt)
  ), c.id, null, p_payout_ref, 'tranche ' || t.seq);
  update public.campaign_tranches set status = 'released', released_minor = v_amt, released_at = now() where id = t.id;
  if v_last then update public.campaigns set status = 'released' where id = c.id; end if;
  insert into public.outbox (topic, payload) values ('notify.milestone_released', jsonb_build_object('tranche_id', t.id));
  insert into public.audit_events (action, entity, entity_id, data)
  values ('tranche.released', 'tranche', t.id, jsonb_build_object('amount_minor', v_amt, 'payout_ref', p_payout_ref));
  return v_amt;
end $$;

-- ── Reconciliation (FR-PAY-007, processor slice) ───────────────────────
create table public.recon_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  ledger_total_minor bigint,
  provider_total_minor bigint,
  diff_minor bigint,
  campaigns jsonb not null default '[]',
  error text,
  correlation_id text default public.ctx('correlation_id'),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.recon_breaks (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  kind text not null check (kind in ('campaign_diff', 'unmatched_provider_txn', 'unmatched_ledger_txn', 'amount_mismatch', 'counter_mismatch', 'waiting_funds')),
  campaign_id uuid references public.campaigns (id),
  amount_minor bigint not null default 0,
  refs jsonb not null default '{}',
  first_run_id uuid references public.recon_runs (id),
  last_run_id uuid references public.recon_runs (id),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create unique index recon_breaks_open_key on public.recon_breaks (dedupe_key) where resolved_at is null;
alter table public.recon_runs enable row level security;
alter table public.recon_breaks enable row level security;
revoke all on public.recon_runs, public.recon_breaks from anon, authenticated;

-- Ledger side of the reconciliation, per campaign (design §7): escrow_cash + platform_funding on the campaign's
-- transactions = what should sit at the processor for that campaign.
create function public.recon_ledger_by_campaign()
returns table (campaign_id uuid, expected_minor bigint, raised_minor bigint, backers_count integer,
               ledger_raised_minor bigint, ledger_backers integer)
language sql stable security definer set search_path = '' as $$
  with e as (
    select t.campaign_id,
           coalesce(sum(en.amount_minor) filter (where a.kind in ('escrow_cash', 'platform_funding')), 0)::bigint as expected_minor
      from public.ledger_transactions t
      join public.ledger_entries en on en.transaction_id = t.id
      join public.ledger_accounts a on a.id = en.account_id
     where t.campaign_id is not null
     group by t.campaign_id
  ), r as (
    select b.campaign_id,
           coalesce(sum(b.captured_minor), 0)::bigint as ledger_raised_minor,
           count(distinct b.backer_id)::integer as ledger_backers
      from public.backings b
     where b.counted
       and exists (select 1 from public.ledger_transactions t where t.backing_id = b.id and t.kind = 'backing.captured')
       and not exists (select 1 from public.ledger_transactions t where t.backing_id = b.id and t.kind = 'backing.refunded')
     group by b.campaign_id
  )
  select c.id, coalesce(e.expected_minor, 0), c.raised_minor, c.backers_count,
         coalesce(r.ledger_raised_minor, 0), coalesce(r.ledger_backers, 0)
    from public.campaigns c left join e on e.campaign_id = c.id left join r on r.campaign_id = c.id
   where e.campaign_id is not null or c.raised_minor <> 0 or c.backers_count <> 0
$$;

-- ── Privileges ─────────────────────────────────────────────────────────
revoke execute on function
  public.recount_backers(uuid),
  public.create_backing_hold(uuid, uuid, uuid, integer, text, integer, integer),
  public.release_backing_hold(uuid, text),
  public.apply_payment_captured(uuid, text, bigint, text, bigint, text),
  public.request_backing_refund(uuid, text),
  public.record_refund_confirmed(uuid, text, bigint, text),
  public.submit_tranche_evidence(uuid, uuid, text, text[]),
  public.record_tranche_released(uuid, text, bigint, text),
  public.recon_ledger_by_campaign()
from public, anon, authenticated;
grant execute on function
  public.recount_backers(uuid),
  public.create_backing_hold(uuid, uuid, uuid, integer, text, integer, integer),
  public.release_backing_hold(uuid, text),
  public.apply_payment_captured(uuid, text, bigint, text, bigint, text),
  public.request_backing_refund(uuid, text),
  public.record_refund_confirmed(uuid, text, bigint, text),
  public.submit_tranche_evidence(uuid, uuid, text, text[]),
  public.record_tranche_released(uuid, text, bigint, text),
  public.recon_ledger_by_campaign()
to service_role;
