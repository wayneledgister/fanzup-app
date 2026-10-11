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
   where cm.id = p_campaign
     -- Take the campaign lock the backing insert's foreign key would take anyway, but BEFORE the perk lock, so
     -- this function also follows campaign → backing → perk (a capture or settlement holding the campaign and
     -- then touching the perk can't deadlock with us). KEY SHARE doesn't block other checkouts.
     for key share of cm;
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

-- ── Capture (FR-PAY-003; design §3.5, §3.5.1) ──────────────────────────
-- Applies a confirmed payment. Anything the platform can't accept (hold expired, campaign closed, amount or
-- currency differs) is still recorded — money in — and a full refund of what was actually captured is queued —
-- money out. Idempotent on p_idem = 'capture:<payment_ref>' (keyed by the payment, not the backing).
-- Lock order (every money function): campaign → backing(s) → perk, the same order settle_campaign uses, so a
-- capture racing the deadline can't deadlock against settlement. The backing's campaign_id is read unlocked (it
-- never changes), then the campaign and the backing are locked — both BEFORE the idempotency check, so two
-- processors racing on one capture serialise: the second sees the first's posting and returns 'duplicate'.
-- Returns 'applied', 'duplicate', 'stray' (the backing already belongs to a different payment: the caller hands
-- the payment to apply_stray_capture) or 'refund:<reason>'.
create function public.apply_payment_captured(
  p_backing uuid, p_payment_ref text, p_amount bigint, p_currency text, p_fee bigint, p_idem text)
returns text language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns; v_campaign uuid; v_reason text; v_new_backer boolean;
begin
  select campaign_id into v_campaign from public.backings where id = p_backing;
  if not found then
    raise exception using errcode = 'P0001', message = 'backing_not_found', detail = 'No backing for this payment.';
  end if;
  select * into c from public.campaigns where id = v_campaign for update;
  select * into b from public.backings where id = p_backing for update;
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  -- A second, different payment for a backing that already has one: money we hold for nobody (§3.5.1 rule 4).
  if b.payment_ref is not null and b.payment_ref <> p_payment_ref then return 'stray'; end if;
  if p_amount <= 0 or p_fee < 0 or p_fee >= p_amount then
    raise exception using errcode = 'P0001', message = 'invalid_capture', detail = 'Captured amount or fee is invalid.';
  end if;

  v_reason := case
    when b.status = 'canceled' then 'hold_expired'
    when b.status <> 'pending_payment' then 'unexpected_state_' || b.status::text
    when c.status <> 'live' or now() >= c.ends_at then 'campaign_closed'
    when lower(p_currency) <> c.currency then 'currency_mismatch'
    when p_amount <> b.amount_minor then 'amount_mismatch'
    else null end;

  if v_reason is null then
    v_new_backer := not exists (select 1 from public.backings x where x.campaign_id = c.id and x.backer_id = b.backer_id and x.counted and x.id <> b.id);
    update public.backings
       set status = 'held', payment_ref = p_payment_ref, processing_fee_minor = p_fee, captured_minor = p_amount,
           captured_currency = lower(p_currency), hold_expires_at = null, counted = true
     where id = b.id;
    update public.campaigns
       set raised_minor = raised_minor + b.amount_minor, backers_count = backers_count + case when v_new_backer then 1 else 0 end
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

  -- Not applicable: record the money in (what the provider actually captured), owe it back, queue the full refund.
  if b.units_held and b.status = 'pending_payment' then
    update public.perks set claimed = claimed - b.quantity where id = b.perk_id;
  end if;
  update public.backings
     set status = 'refund_pending', payment_ref = coalesce(payment_ref, p_payment_ref), processing_fee_minor = p_fee,
         captured_minor = p_amount, captured_currency = lower(p_currency), hold_expires_at = null,
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
  if v_reason in ('amount_mismatch', 'currency_mismatch') then
    insert into public.recon_breaks (dedupe_key, kind, campaign_id, amount_minor, refs)
    values (v_reason || ':' || p_payment_ref, v_reason, c.id, p_amount - b.amount_minor,
            jsonb_build_object('payment_ref', p_payment_ref, 'backing_id', b.id, 'expected_minor', b.amount_minor, 'captured_minor', p_amount,
                               'expected_currency', c.currency, 'captured_currency', lower(p_currency)))
    on conflict do nothing;
  end if;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.capture_unapplied', 'backing', b.id, jsonb_build_object('reason', v_reason, 'amount_minor', p_amount, 'fee_minor', p_fee));
  return 'refund:' || v_reason;
end $$;

-- Stray capture (design §3.5.1 rule 4): a payment that names one of our campaigns but no backing it can apply to.
-- Posts the money in against the campaign's backer_liability (no counters, no backing change) and creates its own
-- refund op keyed by the payment. Same payment twice → one posting, one op.
create function public.apply_stray_capture(
  p_campaign uuid, p_payment_ref text, p_amount bigint, p_currency text, p_fee bigint, p_event uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_idem text := 'capture:' || p_payment_ref;
begin
  perform pg_advisory_xact_lock(hashtext(v_idem));
  if exists (select 1 from public.ledger_transactions where idempotency_key = v_idem) then return 'duplicate'; end if;
  if not exists (select 1 from public.campaigns where id = p_campaign) then
    raise exception using errcode = 'P0001', message = 'campaign_not_found', detail = 'No campaign for this payment.';
  end if;
  if p_amount <= 0 or p_fee < 0 or p_fee >= p_amount then
    raise exception using errcode = 'P0001', message = 'invalid_capture', detail = 'Captured amount or fee is invalid.';
  end if;
  perform public.ledger_post('payment.captured_stray', v_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('escrow_cash', p_campaign), 'amount', p_amount - p_fee),
    jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', p_fee),
    jsonb_build_object('account', public.ledger_account('backer_liability', p_campaign), 'amount', -p_amount)
  ), p_campaign, null, p_payment_ref, 'stray capture (' || lower(p_currency) || ')');
  insert into public.outbound_ops (kind, subject_id, campaign_id, payment_ref, amount_minor, idempotency_key, reason)
  values ('refund', p_event, p_campaign, p_payment_ref, p_amount, 'refund:pay:' || p_payment_ref, 'stray_capture')
  on conflict do nothing;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('payment.captured_stray', 'campaign', p_campaign,
          jsonb_build_object('payment_ref', p_payment_ref, 'amount_minor', p_amount, 'fee_minor', p_fee, 'event_id', p_event));
  return 'stray';
end $$;

-- The stray capture's refund confirmed: same legs as backing.refunded (FanZuP absorbs the fee). The amount must be
-- exactly what the stray capture took in.
create function public.record_stray_refund_confirmed(p_payment_ref text, p_refund_ref text, p_amount bigint, p_idem text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tx uuid; v_cap uuid; v_campaign uuid; v_amount bigint; v_fee bigint;
begin
  perform pg_advisory_xact_lock(hashtext('capture:' || p_payment_ref));
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idem;
  if v_tx is not null then return v_tx; end if;
  select t.id, t.campaign_id into v_cap, v_campaign
    from public.ledger_transactions t where t.idempotency_key = 'capture:' || p_payment_ref and t.kind = 'payment.captured_stray';
  if v_cap is null then
    raise exception using errcode = 'P0001', message = 'stray_not_found', detail = 'No stray capture for this payment.';
  end if;
  select -sum(e.amount_minor) filter (where a.kind = 'backer_liability'), sum(e.amount_minor) filter (where a.kind = 'processing_fees')
    into v_amount, v_fee
    from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where e.transaction_id = v_cap;
  if p_amount <> v_amount then
    raise exception using errcode = 'P0001', message = 'refund_amount_mismatch',
      detail = format('Provider refunded %s, stray capture was %s.', p_amount, v_amount);
  end if;
  v_tx := public.ledger_post('payment.stray_refunded', p_idem, jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('backer_liability', v_campaign), 'amount', v_amount),
    jsonb_build_object('account', public.ledger_account('escrow_cash', v_campaign), 'amount', -(v_amount - v_fee)),
    jsonb_build_object('account', public.ledger_account('platform_funding'), 'amount', -v_fee),
    jsonb_build_object('account', public.ledger_account('platform_absorbed_fees'), 'amount', v_fee),
    jsonb_build_object('account', public.ledger_account('processing_fees'), 'amount', -v_fee)
  ), v_campaign, null, p_refund_ref, 'stray refund of ' || p_payment_ref);
  insert into public.audit_events (action, entity, entity_id, data)
  values ('payment.stray_refunded', 'campaign', v_campaign,
          jsonb_build_object('payment_ref', p_payment_ref, 'refund_ref', p_refund_ref, 'amount_minor', v_amount));
  return v_tx;
end $$;

-- ── Refunds (counter rule, design §3.5) ────────────────────────────────
-- Public counters (raised_minor, backers_count, perk units) count only held + released backings. They fall the
-- moment a backing leaves `held` for `refund_pending` — here and in settle_campaign's failed branch — never at
-- refund confirmation.
create function public.leave_held_for_refund(p_backing uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.backings;
begin
  -- Lock order campaign → backing (a no-op re-lock when the caller already holds the campaign).
  perform 1 from public.campaigns where id = (select campaign_id from public.backings where id = p_backing) for update;
  select * into b from public.backings where id = p_backing for update;
  if b.status <> 'held' then raise exception 'backing % is %, expected held', b.id, b.status; end if;
  if b.counted then
    update public.campaigns set raised_minor = raised_minor - b.amount_minor where id = b.campaign_id;
  end if;
  if b.units_held then update public.perks set claimed = claimed - b.quantity where id = b.perk_id; end if;
  update public.backings set status = 'refund_pending', counted = false, units_held = false where id = b.id;
  perform public.recount_backers(b.campaign_id);
end $$;

-- Staff refund of one backing (FR-DSP-001 M1 slice): a held backing on a live campaign. A failed campaign's
-- backings are already refund_pending from settlement; funded-campaign refunds are M2.
create function public.request_backing_refund(p_backing uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns; v_campaign uuid;
begin
  -- Lock order campaign → backing (see apply_payment_captured).
  select campaign_id into v_campaign from public.backings where id = p_backing;
  if not found then raise exception using errcode = 'P0001', message = 'backing_not_found', detail = 'No such backing.'; end if;
  select * into c from public.campaigns where id = v_campaign for update;
  select * into b from public.backings where id = p_backing for update;
  if b.status <> 'held' or c.status <> 'live' then
    raise exception using errcode = 'P0001', message = 'refund_not_available',
      detail = 'Only a backing held on a live campaign can be refunded in M1.';
  end if;
  perform public.leave_held_for_refund(b.id);
  insert into public.outbox (topic, payload) values
    ('backing.refund', jsonb_build_object('backing_id', b.id, 'reason', 'staff_refund')),
    ('notify.refund_started', jsonb_build_object('backing_id', b.id, 'reason', 'staff_refund'));
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.refund_requested', 'backing', b.id, jsonb_build_object('reason', p_reason));
end $$;

-- Provider confirmed a refund. One function for every backing refund path. Backers get the FULL captured amount
-- back; FanZuP absorbs the non-refundable processing fee (E1 card C default until Wayne decides it).
-- Requires refund_pending; changes no counters (they fell when the backing left `held`).
create function public.record_refund_confirmed(p_backing uuid, p_refund_ref text, p_amount bigint, p_idem text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.backings; c public.campaigns; v_campaign uuid; v_tx uuid;
begin
  -- Lock order campaign → backing (see apply_payment_captured), both before the idempotency check.
  select campaign_id into v_campaign from public.backings where id = p_backing;
  if not found then raise exception using errcode = 'P0001', message = 'backing_not_found', detail = 'No such backing.'; end if;
  select * into c from public.campaigns where id = v_campaign for update;
  select * into b from public.backings where id = p_backing for update;
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idem;
  if v_tx is not null then return v_tx; end if;
  if b.status <> 'refund_pending' then
    raise exception using errcode = 'P0001', message = 'refund_state', detail = format('Backing is %s, not refund_pending.', b.status);
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

  update public.backings set status = 'refunded', refund_ref = p_refund_ref where id = b.id;
  if c.status = 'failed' and not exists (
       select 1 from public.backings where campaign_id = c.id and status in ('held', 'refund_pending')) then
    update public.campaigns set status = 'refunded' where id = c.id;
  end if;
  insert into public.outbox (topic, payload) values ('notify.refund_completed', jsonb_build_object('backing_id', b.id));
  insert into public.audit_events (action, entity, entity_id, data)
  values ('backing.refunded', 'backing', b.id, jsonb_build_object('amount_minor', b.captured_minor, 'refund_ref', p_refund_ref));
  return v_tx;
end $$;

-- Every refund now goes through record_refund_confirmed / record_stray_refund_confirmed, every capture through
-- apply_payment_captured / apply_stray_capture. Dropping the old functions also drops their grants.
drop function public.record_backing_refunded(uuid, text, text);
drop function public.record_backing_captured(uuid, text, bigint, text);

-- ── Settlement (counter rule; refunds and releases flow through outbound_ops) ──
-- The public figures for a settled campaign (design §3.5): what was held at the deadline.
alter table public.campaigns
  add column settled_raised_minor bigint check (settled_raised_minor is null or settled_raised_minor >= 0),
  add column settled_backers_count integer check (settled_backers_count is null or settled_backers_count >= 0);

-- Backfill campaigns that predate M1 (PR #7 review round 2). Pre-M1 code never lowered raised_minor/backers_count
-- after settlement, so for an already-settled campaign they ARE the deadline figures: keep them as the public
-- settled figures, then bring the live counters onto the M1 counter rule (held + released only).
update public.campaigns
   set settled_raised_minor = raised_minor, settled_backers_count = backers_count
 where settled_at is not null and settled_raised_minor is null;
-- A pre-M1 failed campaign's still-held backings are owed refunds (their backing.refund outbox rows are already
-- queued): move them to refund_pending exactly as settle_campaign's failed branch now does, units given back.
update public.perks p set claimed = p.claimed - x.qty
  from (select b.perk_id, sum(b.quantity)::integer as qty
          from public.backings b join public.campaigns c on c.id = b.campaign_id
         where c.status = 'failed' and b.status = 'held' and b.units_held
         group by b.perk_id) x
 where p.id = x.perk_id;
update public.backings b set status = 'refund_pending', counted = false, units_held = false
  from public.campaigns c
 where c.id = b.campaign_id and c.status = 'failed' and b.status = 'held';
update public.campaigns c
   set raised_minor = coalesce((select sum(b.amount_minor) from public.backings b where b.campaign_id = c.id and b.counted), 0),
       backers_count = (select count(distinct b.backer_id) from public.backings b where b.campaign_id = c.id and b.counted);

create or replace function public.settle_campaign(p_campaign uuid, p_now timestamptz default now())
returns public.campaign_status language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; v_held bigint; v_fees bigint; v_outcome public.campaign_status; v_t1 uuid; r record;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then raise exception using errcode = 'P0001', message = 'campaign_not_found', detail = 'No such campaign.'; end if;
  if c.status <> 'live' then return c.status; end if;                 -- idempotent: already settled
  if p_now < c.ends_at then raise exception 'campaign % has not reached its deadline', c.id; end if;
  -- Lock the campaign's backings so no capture or refund request changes them while we settle.
  perform 1 from public.backings where campaign_id = c.id for update;
  select coalesce(sum(amount_minor), 0), coalesce(sum(processing_fee_minor), 0) into v_held, v_fees
    from public.backings where campaign_id = c.id and status = 'held';
  if v_held <> c.raised_minor then
    raise exception 'campaign % raised_minor % differs from its held total %', c.id, c.raised_minor, v_held;
  end if;
  update public.campaigns set settled_raised_minor = c.raised_minor, settled_backers_count = c.backers_count where id = c.id;

  if c.raised_minor >= c.goal_minor then
    v_outcome := 'funded';
    -- Only `held` backings are paid to the artist. A refund_pending backing finishes refunding from
    -- backer_liability / escrow_cash through its own op, so the artist is never credited refunded cents.
    perform public.ledger_post('campaign.funded', 'campaign.funded:' || c.id, jsonb_build_array(
      jsonb_build_object('account', public.ledger_account('backer_liability', c.id), 'amount', v_held),
      jsonb_build_object('account', public.ledger_account('artist_payable', c.id), 'amount', -v_held),
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
    -- held → refund_pending: counters fall as each backing leaves `held` (counter rule).
    for r in select id from public.backings where campaign_id = c.id and status = 'held' order by created_at loop
      perform public.leave_held_for_refund(r.id);
      insert into public.outbox (topic, payload) values ('backing.refund', jsonb_build_object('backing_id', r.id, 'reason', 'campaign_failed'));
    end loop;
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

-- Tranche amounts are a share of what was raised at settlement, net of the released backings' processing fees.
create or replace function public.tranche_release_amount(p_tranche uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare t public.campaign_tranches; v_payable bigint; v_net bigint;
begin
  select * into t from public.campaign_tranches where id = p_tranche;
  v_payable := -public.ledger_balance(public.ledger_account('artist_payable', t.campaign_id));
  if not exists (select 1 from public.campaign_tranches where campaign_id = t.campaign_id and seq > t.seq) then
    return v_payable;
  end if;
  select coalesce(c.settled_raised_minor, c.raised_minor)
         - coalesce((select sum(processing_fee_minor) from public.backings where campaign_id = c.id and status = 'released'), 0)
    into v_net from public.campaigns c where c.id = t.campaign_id;
  return least(v_payable, (v_net * t.pct) / 100);
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
declare t public.campaign_tranches; c public.campaigns; v_campaign uuid; v_amt bigint; v_last boolean;
begin
  -- Lock order campaign → tranche (settle_campaign's order), both BEFORE the idempotency check, so a concurrent
  -- duplicate waits for the first confirmation to commit and then returns its amount instead of failing on status.
  select campaign_id into v_campaign from public.campaign_tranches where id = p_tranche;
  if not found then raise exception 'tranche % not found', p_tranche; end if;
  select * into c from public.campaigns where id = v_campaign for update;
  select * into t from public.campaign_tranches where id = p_tranche for update;
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return t.released_minor; end if;
  if t.status <> 'verified' then raise exception 'tranche % is %, expected verified', p_tranche, t.status; end if;
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
  -- Which kinds pause payouts is listed in apps/api/src/recon.ts (PAYOUT_PAUSING_KINDS) and design §7.
  kind text not null check (kind in ('campaign_diff', 'unmatched_provider_txn', 'unmatched_ledger_txn', 'amount_mismatch', 'currency_mismatch',
                                     'liability_mismatch', 'stray_capture_aged', 'counter_mismatch', 'waiting_funds')),
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

-- Ledger side of the reconciliation, per campaign (design §7):
--  expected_minor   = escrow_cash + platform_funding on the campaign's transactions = what should sit at the processor;
--  counters         = raised_minor/backers_count vs Σ amount_minor / distinct backers over held + released backings;
--  liability        = −balance(backer_liability) vs Σ coalesce(captured_minor, amount_minor) over held + refund_pending
--                     backings + Σ open stray captures (a payment.captured_stray with no payment.stray_refunded yet).
create function public.recon_ledger_by_campaign()
returns table (campaign_id uuid, expected_minor bigint, raised_minor bigint, backers_count integer,
               ledger_raised_minor bigint, ledger_backers integer, liability_minor bigint, expected_liability_minor bigint)
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
           coalesce(sum(b.amount_minor) filter (where b.status in ('held', 'released')), 0)::bigint as ledger_raised_minor,
           (count(distinct b.backer_id) filter (where b.status in ('held', 'released')))::integer as ledger_backers,
           coalesce(sum(coalesce(b.captured_minor, b.amount_minor)) filter (where b.status in ('held', 'refund_pending')), 0)::bigint as owed_backings
      from public.backings b
     group by b.campaign_id
  ), s as (
    select t.campaign_id, coalesce(-sum(en.amount_minor), 0)::bigint as owed_strays
      from public.ledger_transactions t
      join public.ledger_entries en on en.transaction_id = t.id
      join public.ledger_accounts a on a.id = en.account_id and a.kind = 'backer_liability'
     where t.kind = 'payment.captured_stray'
       and not exists (select 1 from public.ledger_transactions x
                        where x.idempotency_key = 'refund:pay:' || substr(t.idempotency_key, length('capture:') + 1))
     group by t.campaign_id
  ), l as (
    select a.campaign_id, coalesce(-sum(en.amount_minor), 0)::bigint as liability_minor
      from public.ledger_accounts a join public.ledger_entries en on en.account_id = a.id
     where a.kind = 'backer_liability' and a.campaign_id is not null
     group by a.campaign_id
  )
  select c.id, coalesce(e.expected_minor, 0), c.raised_minor, c.backers_count,
         coalesce(r.ledger_raised_minor, 0), coalesce(r.ledger_backers, 0),
         coalesce(l.liability_minor, 0), coalesce(r.owed_backings, 0) + coalesce(s.owed_strays, 0)
    from public.campaigns c
    left join e on e.campaign_id = c.id left join r on r.campaign_id = c.id
    left join s on s.campaign_id = c.id left join l on l.campaign_id = c.id
   where e.campaign_id is not null or c.raised_minor <> 0 or c.backers_count <> 0 or coalesce(r.owed_backings, 0) <> 0
$$;

-- ── Privileges ─────────────────────────────────────────────────────────
revoke execute on function
  public.recount_backers(uuid),
  public.create_backing_hold(uuid, uuid, uuid, integer, text, integer, integer),
  public.release_backing_hold(uuid, text),
  public.apply_payment_captured(uuid, text, bigint, text, bigint, text),
  public.apply_stray_capture(uuid, text, bigint, text, bigint, uuid),
  public.record_stray_refund_confirmed(text, text, bigint, text),
  public.leave_held_for_refund(uuid),
  public.request_backing_refund(uuid, text),
  public.record_refund_confirmed(uuid, text, bigint, text),
  public.submit_tranche_evidence(uuid, uuid, text, text[]),
  public.record_tranche_released(uuid, text, bigint, text),
  public.recon_ledger_by_campaign(),
  public.tranche_release_amount(uuid)
from public, anon, authenticated;
grant execute on function
  public.recount_backers(uuid),
  public.create_backing_hold(uuid, uuid, uuid, integer, text, integer, integer),
  public.release_backing_hold(uuid, text),
  public.apply_payment_captured(uuid, text, bigint, text, bigint, text),
  public.apply_stray_capture(uuid, text, bigint, text, bigint, uuid),
  public.record_stray_refund_confirmed(text, text, bigint, text),
  public.leave_held_for_refund(uuid),
  public.request_backing_refund(uuid, text),
  public.record_refund_confirmed(uuid, text, bigint, text),
  public.submit_tranche_evidence(uuid, uuid, text, text[]),
  public.record_tranche_released(uuid, text, bigint, text),
  public.recon_ledger_by_campaign(),
  public.tranche_release_amount(uuid)
to service_role;
