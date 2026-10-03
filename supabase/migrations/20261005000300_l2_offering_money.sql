-- Layer 2 (CR-002) · offering workflow and money: Form C review, launch, Reg CF limit, Unit reservations, fund moves
-- into escrow, target-or-refund settlement, refunds, milestone tranches, outbound ops. Design §3–§5; 01a §2–3.
-- Every function: security definer, empty search_path, service_role only (0500), refuses when the flag is off.

-- ── Outbound operations (two-phase, M1 pattern; ADR-007 §5) ────────────
create table public.pool_ops (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'disburse', 'payout', 'close_offering')),
  subject_id uuid not null,                       -- investment | pool tranche | distribution payout | pool
  pool_id uuid not null references public.pools (id),
  amount_minor bigint not null check (amount_minor >= 0),
  idempotency_key text not null unique,
  status text not null default 'initiated' check (status in ('initiated', 'sent', 'confirmed', 'failed', 'dead')),
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
create index pool_ops_due_idx on public.pool_ops (next_attempt_at) where status = 'initiated';
create trigger pool_ops_touch before update on public.pool_ops for each row execute function public.touch_updated_at();

create function public.l2_queue_op(p_kind text, p_subject uuid, p_pool uuid, p_amount bigint) returns void
language sql security definer set search_path = '' as $$
  insert into public.pool_ops (kind, subject_id, pool_id, amount_minor, idempotency_key)
  values (p_kind, p_subject, p_pool, p_amount, p_kind || ':' || p_subject)
  on conflict (kind, subject_id) do nothing
$$;

create function public.l2_owner(p_pool uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select a.owner_id from public.pools p join public.artists a on a.id = p.artist_id where p.id = p_pool
$$;

-- ── Workflow ───────────────────────────────────────────────────────────
-- Submit for Form C review (FR-L2-CR-001…005). The API generates the mock Form C and passes it with its hash.
create function public.submit_pool(p_pool uuid, p_user uuid, p_form_c jsonb, p_sha256 text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.pools; a public.artists; v_cap bigint; v_other bigint; v_funds bigint; v_pct int; v_n int; v_doc uuid; v_ver int; m public.collection_mechanisms;
begin
  perform public.l2_assert_enabled();
  select * into p from public.pools where id = p_pool for update;
  if not found or public.l2_owner(p_pool) <> p_user then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  if p.status not in ('draft', 'revisions_requested') then perform public.l2_fail('pool_not_editable', format('This Pool is %s and can''t be submitted.', p.status)); end if;
  select * into a from public.artists where id = p.artist_id;
  -- PRD 01 §6.3: Starter has no Reg CF access; the tier is assessed here, at submission.
  select reg_cf_cap_minor into v_cap from public.tier_limits where tier = a.tier;
  if v_cap is null then perform public.l2_fail('tier_not_eligible', 'Revenue-share Pools open at Rising tier. Starter creators can run reward campaigns.'); end if;
  if a.identity_status <> 'verified' then perform public.l2_fail('identity_required', 'Verify your identity before submitting a Pool.'); end if;
  -- Issuer cap per rolling 12 months across all of this creator's Reg CF offerings.
  select coalesce(sum(case when x.status in ('funded', 'matured') then x.raised_minor else x.max_minor end), 0) into v_other
    from public.pools x
   where x.artist_id = p.artist_id and x.id <> p.id
     and (x.status in ('in_review', 'approved', 'live') or (x.status in ('funded', 'matured') and x.closed_at > now() - interval '12 months'));
  if v_other + p.max_minor > v_cap then
    perform public.l2_fail('tier_cap_exceeded', format('%s creators can raise up to %s cents in 12 months across all Pools; %s is already committed.', a.tier, v_cap, v_other));
  end if;
  select coalesce(sum((x ->> 'amountMinor')::bigint), 0), count(*) into v_funds, v_n from jsonb_array_elements(p.use_of_funds) x;
  if v_n = 0 or v_funds <> p.target_minor then perform public.l2_fail('use_of_funds_mismatch', 'Use-of-funds line items must add up to the funding target.'); end if;
  if jsonb_array_length(p.tracklist) = 0 then perform public.l2_fail('tracklist_required', 'Add the album''s tracklist.'); end if;
  select coalesce(sum(pct), 0), count(*) into v_pct, v_n from public.pool_tranches where pool_id = p.id;
  if v_n < 2 or v_pct <> 100 then perform public.l2_fail('tranches_invalid', 'Set 2 or 3 production milestones that add up to 100%.'); end if;
  select * into m from public.collection_mechanisms where pool_id = p.id;
  if not found then perform public.l2_fail('collection_required', 'Choose how the Pool''s royalties will be collected.'); end if;
  if p_sha256 is null or p_form_c is null then perform public.l2_fail('form_c_required', 'The Form C draft is missing.'); end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.pool_documents where pool_id = p.id and kind = 'form_c';
  insert into public.pool_documents (pool_id, kind, version, body, sha256) values (p.id, 'form_c', v_ver, p_form_c, p_sha256) returning id into v_doc;
  update public.collection_mechanisms set mechanism = p.collection_mechanism, revenue_types = p.revenue_types,
         badge = public.l2_risk_badge(p.collection_mechanism, p.revenue_types)
   where pool_id = p.id and status = 'submitted';
  update public.pools set status = 'in_review', tier_at_submission = a.tier, cap_minor_at_submission = v_cap, form_c_document_id = v_doc,
         risk_badge = public.l2_risk_badge(p.collection_mechanism, p.revenue_types)
   where id = p.id;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'pool.submitted', 'pool', p.id, jsonb_build_object('tier', a.tier, 'target_minor', p.target_minor, 'form_c_sha256', p_sha256));
  return v_doc;
end $$;

-- Form C review (staff). Reviewer ≠ owner (FR-ID-003).
create function public.review_pool(p_pool uuid, p_reviewer uuid, p_decision text, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.pools; v_sha text;
begin
  perform public.l2_assert_enabled();
  select * into p from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  if public.l2_owner(p_pool) = p_reviewer then perform public.l2_fail('reviewer_is_owner', 'You can''t review a Pool you own.'); end if;
  if p_decision not in ('approved', 'revisions_requested') then perform public.l2_fail('invalid_decision', 'Approve or request revisions.'); end if;
  if p_decision = 'revisions_requested' and coalesce(btrim(p_notes), '') = '' then perform public.l2_fail('notes_required', 'Explain what needs to change.'); end if;
  if p.status <> 'in_review' then perform public.l2_fail('pool_not_in_review', 'This Pool isn''t waiting for review.'); end if;
  select sha256 into v_sha from public.pool_documents where id = p.form_c_document_id;
  update public.pools set status = p_decision::public.pool_status where id = p.id;
  insert into public.pool_reviews (pool_id, reviewer_id, decision, notes, form_c_sha256) values (p.id, p_reviewer, p_decision, p_notes, v_sha);
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_reviewer, 'pool.reviewed', 'pool', p.id, jsonb_build_object('decision', p_decision, 'form_c_sha256', v_sha));
end $$;

-- Staff execute the collection-mechanism record (01b AC-R6). Executor ≠ owner.
create function public.execute_collection_mechanism(p_pool uuid, p_staff uuid, p_details jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.l2_assert_enabled();
  if public.l2_owner(p_pool) = p_staff then perform public.l2_fail('reviewer_is_owner', 'You can''t execute a Pool you own.'); end if;
  update public.collection_mechanisms
     set status = 'executed', executed_by = p_staff, executed_at = now(), details = details || coalesce(p_details, '{}')
   where pool_id = p_pool and status = 'submitted';
  if not found then perform public.l2_fail('collection_not_submitted', 'There''s no submitted collection mechanism to execute.'); end if;
  insert into public.audit_events (actor_id, action, entity, entity_id) values (p_staff, 'pool.collection_executed', 'pool', p_pool);
end $$;

-- Creator launches: provider issuer/offering/collection account already exist (refs passed in). Clock starts now.
create function public.launch_pool(p_pool uuid, p_user uuid, p_issuer_ref text, p_offering_ref text, p_collection_ref text, p_legal_name text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare p public.pools; v_issuer uuid; v_ends timestamptz;
begin
  perform public.l2_assert_enabled();
  select * into p from public.pools where id = p_pool for update;
  if not found or public.l2_owner(p_pool) <> p_user then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  if p.status <> 'approved' then perform public.l2_fail('pool_not_approved', 'A Pool must pass Form C review before it can go live.'); end if;
  if not exists (select 1 from public.collection_mechanisms where pool_id = p.id and status = 'executed') then
    perform public.l2_fail('collection_not_executed', 'The collection agreement must be executed before the Pool can go live.');
  end if;
  insert into public.issuers (artist_id, legal_name, provider_issuer_ref) values (p.artist_id, p_legal_name, p_issuer_ref)
  on conflict (artist_id) do update set provider_issuer_ref = coalesce(public.issuers.provider_issuer_ref, excluded.provider_issuer_ref)
  returning id into v_issuer;
  v_ends := now() + make_interval(days => p.duration_days);
  update public.pools set status = 'live', issuer_id = v_issuer, provider_offering_ref = p_offering_ref, provider_collection_ref = p_collection_ref,
         starts_at = now(), ends_at = v_ends
   where id = p.id;
  insert into public.revenue_sources (pool_id, revenue_type, kind, name)
  select p.id, t, case p.collection_mechanism when 'LOCKBOX' then 'lockbox' when 'SELF_REPORT' then 'self_report'
                       when 'SPLIT_PAYEE' then 'split_payee' when 'LETTER_OF_DIRECTION' then 'letter_of_direction' else 'distributor' end,
         case t when 'master' then 'Distributor (mock)' when 'sync' then 'Sync licensing (mock)' else 'Publishing / PRO (mock)' end
    from unnest(p.revenue_types) t
  on conflict (pool_id, revenue_type) do nothing;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'pool.launched', 'pool', p.id, jsonb_build_object('offering_ref', p_offering_ref, 'ends_at', v_ends));
  return v_ends;
end $$;

-- ── Reg CF investor limit (17 CFR 227.100(a)(2); POLICY.regCf; 01a §3) ──
create function public.regcf_investor_limit(p_user uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare ip public.investor_profiles; s jsonb := (select value from public.platform_settings where key = 'regcf_limits');
        v_greater bigint; v_t bigint;
begin
  select * into ip from public.investor_profiles where user_id = p_user;
  if not found or ip.certified_at is null then return 0; end if;
  if ip.accredited then return null; end if;
  v_t := (s ->> 'threshold_minor')::bigint;
  v_greater := greatest(coalesce(ip.annual_income_minor, 0), coalesce(ip.net_worth_minor, 0));
  if coalesce(ip.annual_income_minor, 0) < v_t or coalesce(ip.net_worth_minor, 0) < v_t then
    return greatest((s ->> 'floor_minor')::bigint, (v_greater * (s ->> 'low_bps')::bigint) / 10000);
  end if;
  return least(v_t, (v_greater * (s ->> 'high_bps')::bigint) / 10000);
end $$;

-- Usage over the trailing 12 months: every commitment that holds or held money or headroom, plus self-reported elsewhere.
create function public.regcf_usage(p_user uuid, p_now timestamptz default now()) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(i.amount_minor) from public.investments i
                    where i.investor_id = p_user and i.created_at > p_now - interval '12 months'
                      and (i.status in ('funding', 'funded', 'issued', 'refund_pending')
                           or (i.status = 'reserved' and i.reserve_expires_at > p_now))), 0)::bigint
       + coalesce((select elsewhere_12m_minor from public.investor_profiles where user_id = p_user), 0)
$$;

-- ── Reserve Units (AC-I1 / I2 / I5): one transaction; investor row locked, then the Pool row. ──
create function public.reserve_investment(p_user uuid, p_pool uuid, p_units integer, p_ack_version text, p_now timestamptz default now())
returns table (investment_id uuid, amount_minor bigint, reserve_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare ip public.investor_profiles; p public.pools; v_amount bigint; v_limit bigint; v_used bigint; v_id uuid; v_exp timestamptz;
begin
  perform public.l2_assert_enabled();
  select * into ip from public.investor_profiles where user_id = p_user for update;
  if not found or ip.kyc_status <> 'approved' then
    perform public.l2_fail('kyc_required', case coalesce(ip.kyc_status::text, 'not_started')
      when 'pending' then 'Your identity check is still in progress.'
      when 'manual_review' then 'Your identity check needs a manual review. We''ll email you.'
      when 'rejected' then 'We couldn''t verify your identity, so you can''t invest.'
      else 'Verify your identity before investing.' end);
  end if;
  if ip.certified_at is null then perform public.l2_fail('certification_required', 'Confirm your income and net worth so we can work out your investment limit.'); end if;
  if ip.state is null or ip.state in (select jsonb_array_elements_text(public.l2_policy('blocked_states'))) then
    perform public.l2_fail('state_not_eligible', 'This offering isn''t available in your state.');
  end if;
  if p_ack_version is distinct from public.l2_policy('risk_ack_version') #>> '{}' then
    perform public.l2_fail('risk_ack_required', 'Read and acknowledge the current risk disclosure first.');
  end if;
  select * into p from public.pools where id = p_pool for update;
  if not found or p.status <> 'live' or p.ends_at is null or p_now >= p.ends_at then
    perform public.l2_fail('pool_closed', 'This Pool isn''t accepting investments right now.');
  end if;
  if public.l2_owner(p_pool) = p_user then perform public.l2_fail('self_investment', 'You can''t invest in your own Pool.'); end if;
  if p_units < greatest(1, p.min_units) then perform public.l2_fail('below_minimum', format('The minimum is %s Units.', p.min_units)); end if;
  if p.units_committed + p_units > p.units_total then
    perform public.l2_fail('pool_sold_out', format('Only %s Units are left.', p.units_total - p.units_committed));
  end if;
  v_amount := p_units::bigint * p.unit_price_minor;
  v_limit := public.regcf_investor_limit(p_user);
  v_used := public.regcf_usage(p_user, p_now);
  if v_limit is not null and v_used + v_amount > v_limit then
    perform public.l2_fail('regcf_limit_exceeded', format('That''s over your 12-month investment limit. You have %s cents left.', greatest(0, v_limit - v_used)));
  end if;
  v_exp := p_now + make_interval(mins => (public.l2_policy('reserve_minutes') #>> '{}')::int);
  insert into public.investments (pool_id, investor_id, units, unit_price_minor, amount_minor, cap_minor, status, reserve_expires_at, risk_ack_version, risk_ack_at)
  values (p.id, p_user, p_units, p.unit_price_minor, v_amount, (v_amount * p.return_cap_bps) / 10000, 'reserved', v_exp, p_ack_version, p_now)
  returning id into v_id;
  update public.pools set units_committed = units_committed + p_units where id = p.id;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'investment.reserved', 'investment', v_id, jsonb_build_object('pool_id', p.id, 'units', p_units, 'amount_minor', v_amount));
  return query select v_id, v_amount, v_exp;
end $$;

create function public.l2_recount_investors(p_pool uuid) returns void language sql security definer set search_path = '' as $$
  update public.pools set investors_count = (select count(distinct investor_id) from public.investments
                                               where pool_id = p_pool and status in ('funded', 'issued')) where id = p_pool
$$;

-- Trade + fund move created at the provider.
create function public.mark_investment_funding(p_inv uuid, p_trade_ref text, p_fund_ref text) returns text
language plpgsql security definer set search_path = '' as $$
declare i public.investments;
begin
  select * into i from public.investments where id = p_inv for update;
  if not found then perform public.l2_fail('investment_not_found', 'No such investment.'); end if;
  update public.investments set provider_trade_ref = coalesce(provider_trade_ref, p_trade_ref), provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref)
   where id = i.id;
  if i.status = 'reserved' then
    update public.investments set status = 'funding', reserve_expires_at = null where id = i.id;
    return 'funding';
  end if;
  return i.status::text;   -- already moved on (e.g. the settlement webhook beat this call), or expired: the funding event decides
end $$;

-- Fund move settled into the offering escrow (webhook). Anything the offering can't accept is still recorded (money in)
-- and refunded (money out), like M1 late captures. Returns 'applied', 'duplicate' or 'refund:<reason>'.
create function public.record_investment_funded(p_inv uuid, p_fund_ref text, p_amount bigint, p_idem text) returns text
language plpgsql security definer set search_path = '' as $$
declare i public.investments; p public.pools; v_reason text;
begin
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  select * into i from public.investments where id = p_inv for update;
  if not found then perform public.l2_fail('investment_not_found', 'No investment for this fund move.'); end if;
  select * into p from public.pools where id = i.pool_id for update;
  v_reason := case
    when i.status not in ('reserved', 'funding') then 'unexpected_state_' || i.status::text
    when p.status <> 'live' then 'offering_closed'
    when p_amount <> i.amount_minor then 'amount_mismatch'
    else null end;
  perform public.ledger_post_pool('investment.funded', p_idem, p.id, jsonb_build_array(
    jsonb_build_object('kind', 'pool_escrow', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_investor_liability', 'amount', -p_amount)
  ), i.id, p_fund_ref, v_reason);
  if v_reason is null then
    update public.investments set status = 'funded', funded_at = now(), reserve_expires_at = null, provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref) where id = i.id;
    update public.pools set raised_minor = raised_minor + p_amount where id = p.id;
    perform public.l2_recount_investors(p.id);
    insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'investment_funded', 'investment_id', i.id));
    insert into public.audit_events (action, entity, entity_id, data) values ('investment.funded', 'investment', i.id, jsonb_build_object('amount_minor', p_amount));
    return 'applied';
  end if;
  if i.status in ('reserved', 'funding') then
    update public.pools set units_committed = units_committed - i.units where id = p.id;
  end if;
  -- The refund op returns exactly what arrived (p_amount), which may differ from the investment amount.
  update public.investments set status = 'refund_pending', status_reason = v_reason, reserve_expires_at = null,
         provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref) where id = i.id;
  perform public.l2_queue_op('refund', i.id, p.id, p_amount);
  insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs)
  select p.id, 'unapplied_funding', 'unapplied_funding:' || i.id, p_amount, jsonb_build_object('investment_id', i.id, 'reason', v_reason)
   where v_reason = 'amount_mismatch'
  on conflict do nothing;
  insert into public.audit_events (action, entity, entity_id, data) values ('investment.funding_unapplied', 'investment', i.id, jsonb_build_object('reason', v_reason, 'amount_minor', p_amount));
  return 'refund:' || v_reason;
end $$;

-- Fund move returned by the bank (e.g. R01). No money arrived; the reservation's Units and limit come back (AC-I2).
create function public.record_investment_returned(p_inv uuid, p_fund_ref text, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare i public.investments;
begin
  select * into i from public.investments where id = p_inv for update;
  if not found then perform public.l2_fail('investment_not_found', 'No investment for this fund move.'); end if;
  if i.status not in ('reserved', 'funding') then return 'ignored'; end if;
  update public.investments set status = 'returned', status_reason = coalesce(p_code, 'returned'), reserve_expires_at = null where id = i.id;
  update public.pools set units_committed = units_committed - i.units where id = i.pool_id;
  insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'funding_returned', 'investment_id', i.id));
  insert into public.audit_events (action, entity, entity_id, data) values ('investment.returned', 'investment', i.id, jsonb_build_object('code', p_code));
  return 'returned';
end $$;

-- Unfunded reservations expire (AC-I2).
create function public.expire_investment_reservations(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id, pool_id, units from public.investments where status = 'reserved' and reserve_expires_at <= p_now order by reserve_expires_at for update skip locked loop
    update public.investments set status = 'expired', reserve_expires_at = null where id = r.id;
    update public.pools set units_committed = units_committed - r.units where id = r.pool_id;
    insert into public.audit_events (action, entity, entity_id) values ('investment.expired', 'investment', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Investor cancels (Reg CF: until 48 hours before the deadline). Funded money is refunded in full.
create function public.cancel_investment(p_inv uuid, p_user uuid, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare i public.investments; p public.pools;
begin
  perform public.l2_assert_enabled();
  select * into i from public.investments where id = p_inv for update;
  if not found or i.investor_id <> p_user then perform public.l2_fail('investment_not_found', 'We couldn''t find that investment.'); end if;
  select * into p from public.pools where id = i.pool_id for update;
  if p.status <> 'live' or p_now >= p.ends_at - make_interval(hours => (public.l2_policy('cancel_cutoff_hours') #>> '{}')::int) then
    perform public.l2_fail('cancel_window_closed', 'Investments can be cancelled until 48 hours before the offering closes.');
  end if;
  if i.status = 'reserved' then
    update public.investments set status = 'cancelled', cancelled_at = p_now, reserve_expires_at = null where id = i.id;
    update public.pools set units_committed = units_committed - i.units where id = p.id;
  elsif i.status = 'funded' then
    update public.investments set status = 'refund_pending', status_reason = 'cancelled_by_investor', cancelled_at = p_now where id = i.id;
    update public.pools set units_committed = units_committed - i.units, raised_minor = raised_minor - i.amount_minor where id = p.id;
    perform public.l2_recount_investors(p.id);
    perform public.l2_queue_op('refund', i.id, p.id, i.amount_minor);
  elsif i.status = 'funding' then
    perform public.l2_fail('funding_in_progress', 'Your payment is still moving. Try again once it has arrived.');
  else
    perform public.l2_fail('not_cancellable', format('This investment is %s.', i.status));
  end if;
  insert into public.audit_events (actor_id, action, entity, entity_id) values (p_user, 'investment.cancelled', 'investment', i.id);
  return 'cancelled';
end $$;

-- ── Settlement at the deadline (AC-E2 target-or-refund; AC-E3 nothing to the issuer before close) ──
create function public.settle_pool(p_pool uuid, p_now timestamptz default now()) returns public.pool_status
language plpgsql security definer set search_path = '' as $$
declare p public.pools; v_t1 uuid; r record; v_lock interval;
begin
  perform public.l2_assert_enabled();
  select * into p from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No such Pool.'); end if;
  if p.status <> 'live' then return p.status; end if;
  if p_now < p.ends_at then perform public.l2_fail('not_due', 'The offering hasn''t reached its deadline.'); end if;
  -- Fund moves already in flight get a short grace period before the outcome is decided.
  if exists (select 1 from public.investments where pool_id = p.id and status = 'funding')
     and p_now < p.ends_at + make_interval(mins => (public.l2_policy('settle_grace_minutes') #>> '{}')::int) then
    return 'live';
  end if;
  for r in select id, units from public.investments where pool_id = p.id and status = 'reserved' for update loop
    update public.investments set status = 'expired', reserve_expires_at = null where id = r.id;
    update public.pools set units_committed = units_committed - r.units where id = p.id;
  end loop;

  if p.raised_minor >= p.target_minor and p.raised_minor > 0 then
    perform public.ledger_post_pool('pool.closed', 'pool.closed:' || p.id, p.id, jsonb_build_array(
      jsonb_build_object('kind', 'pool_investor_liability', 'amount', p.raised_minor),
      jsonb_build_object('kind', 'pool_issuer_payable', 'amount', -p.raised_minor)
    ), null, p.provider_offering_ref, 'target met');
    v_lock := make_interval(months => (public.l2_policy('lockup_months') #>> '{}')::int);
    update public.investments set status = 'issued', issued_at = p_now, lockup_ends_at = p_now + v_lock where pool_id = p.id and status = 'funded';
    update public.pools set status = 'funded', settled_at = p_now, closed_at = p_now, matures_at = p_now + make_interval(months => p.maturity_months),
           units_issued = (select coalesce(sum(units), 0) from public.investments where pool_id = p.id and status = 'issued'),
           collection_state = 'COLLECTING', collection_state_since = p_now
     where id = p.id;
    update public.pool_tranches set status = 'verified', verified_at = p_now where pool_id = p.id and seq = 1 returning id into v_t1;
    perform public.l2_queue_op('close_offering', p.id, p.id, p.raised_minor);
    if v_t1 is not null then perform public.l2_queue_op('disburse', v_t1, p.id, public.pool_tranche_release_amount(v_t1)); end if;
    insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'pool_funded', 'pool_id', p.id));
    insert into public.audit_events (action, entity, entity_id, data) values ('pool.settled', 'pool', p.id, jsonb_build_object('outcome', 'funded', 'raised_minor', p.raised_minor));
    return 'funded';
  end if;

  for r in select id, amount_minor, units from public.investments where pool_id = p.id and status = 'funded' for update loop
    update public.investments set status = 'refund_pending', status_reason = 'offering_failed' where id = r.id;
    perform public.l2_queue_op('refund', r.id, p.id, r.amount_minor);
  end loop;
  update public.pools set status = 'failed', settled_at = p_now, units_committed = (select coalesce(sum(units), 0) from public.investments where pool_id = p.id and status = 'funding') where id = p.id;
  if not exists (select 1 from public.investments where pool_id = p.id and status in ('refund_pending', 'funding')) then
    update public.pools set status = 'refunded' where id = p.id;
  end if;
  insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'pool_failed', 'pool_id', p.id));
  insert into public.audit_events (action, entity, entity_id, data) values ('pool.settled', 'pool', p.id, jsonb_build_object('outcome', 'failed', 'raised_minor', p.raised_minor, 'target_minor', p.target_minor));
  return 'failed';
end $$;

-- Refund settled at the provider: the investor gets exactly what arrived.
create function public.record_investment_refunded(p_inv uuid, p_ref text, p_amount bigint, p_idem text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.investments; p public.pools; v_tx uuid;
begin
  select id into v_tx from public.ledger_transactions where idempotency_key = p_idem;
  if v_tx is not null then return v_tx; end if;
  select * into i from public.investments where id = p_inv for update;
  if not found then perform public.l2_fail('investment_not_found', 'No such investment.'); end if;
  if i.status <> 'refund_pending' then perform public.l2_fail('refund_state', format('Investment is %s; nothing to refund.', i.status)); end if;
  if p_amount <> (select amount_minor from public.pool_ops where kind = 'refund' and subject_id = i.id) then
    perform public.l2_fail('refund_amount_mismatch', format('Provider refunded %s, owed %s.', p_amount, i.amount_minor));
  end if;
  select * into p from public.pools where id = i.pool_id for update;
  v_tx := public.ledger_post_pool('investment.refunded', p_idem, p.id, jsonb_build_array(
    jsonb_build_object('kind', 'pool_investor_liability', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_escrow', 'amount', -p_amount)
  ), i.id, p_ref, i.status_reason);
  update public.investments set status = 'refunded', refund_ref = p_ref, refunded_at = now() where id = i.id;
  if p.status = 'failed' and not exists (select 1 from public.investments where pool_id = p.id and status in ('refund_pending', 'funding')) then
    update public.pools set status = 'refunded' where id = p.id;
  end if;
  insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'refund_completed', 'investment_id', i.id));
  insert into public.audit_events (action, entity, entity_id, data) values ('investment.refunded', 'investment', i.id, jsonb_build_object('amount_minor', p_amount, 'ref', p_ref));
  return v_tx;
end $$;

-- ── Milestone tranches (AC-E4; M1 rules, Pool-scoped) ──────────────────
create function public.pool_tranche_release_amount(p_tranche uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare t public.pool_tranches; v_payable bigint; v_raised bigint;
begin
  select * into t from public.pool_tranches where id = p_tranche;
  v_payable := -public.pool_balance('pool_issuer_payable', t.pool_id);
  if not exists (select 1 from public.pool_tranches where pool_id = t.pool_id and seq > t.seq) then return v_payable; end if;
  select raised_minor into v_raised from public.pools where id = t.pool_id;
  return least(v_payable, (v_raised * t.pct) / 100);
end $$;

create function public.submit_pool_tranche_evidence(p_tranche uuid, p_user uuid, p_notes text, p_links text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t record; v_id uuid;
begin
  perform public.l2_assert_enabled();
  select tr.id, tr.seq, tr.status, p.status as pool_status, p.id as pool_id into t
    from public.pool_tranches tr join public.pools p on p.id = tr.pool_id where tr.id = p_tranche for update of tr;
  if not found or public.l2_owner(t.pool_id) <> p_user then perform public.l2_fail('tranche_not_found', 'We couldn''t find that milestone.'); end if;
  if t.pool_status not in ('funded', 'matured') or t.seq = 1 or t.status not in ('pending', 'evidence_submitted') then
    perform public.l2_fail('evidence_not_accepted', 'Evidence can be added to a later milestone of a funded Pool before it is verified.');
  end if;
  insert into public.pool_tranche_evidence (tranche_id, submitted_by, notes, links) values (p_tranche, p_user, p_notes, coalesce(p_links, '{}')) returning id into v_id;
  update public.pool_tranches set status = 'evidence_submitted' where id = p_tranche;
  insert into public.audit_events (actor_id, action, entity, entity_id, data) values (p_user, 'pool_tranche.evidence_submitted', 'pool_tranche', p_tranche, jsonb_build_object('evidence_id', v_id));
  return v_id;
end $$;

create function public.verify_pool_tranche(p_tranche uuid, p_reviewer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  perform public.l2_assert_enabled();
  select tr.id, tr.status, tr.pool_id, p.status as pool_status into t
    from public.pool_tranches tr join public.pools p on p.id = tr.pool_id where tr.id = p_tranche for update of tr;
  if not found then perform public.l2_fail('tranche_not_found', 'No such milestone.'); end if;
  if public.l2_owner(t.pool_id) = p_reviewer then perform public.l2_fail('reviewer_is_owner', 'You can''t verify a Pool you own.'); end if;
  if t.pool_status not in ('funded', 'matured') then perform public.l2_fail('pool_not_funded', 'Only a funded Pool''s milestones can be verified.'); end if;
  if t.status <> 'evidence_submitted' then perform public.l2_fail('evidence_required', 'This milestone has no evidence waiting for verification.'); end if;
  update public.pool_tranches set status = 'verified', verified_by = p_reviewer, verified_at = now() where id = p_tranche;
  perform public.l2_queue_op('disburse', p_tranche, t.pool_id, public.pool_tranche_release_amount(p_tranche));
  insert into public.audit_events (actor_id, action, entity, entity_id) values (p_reviewer, 'pool_tranche.verified', 'pool_tranche', p_tranche);
end $$;

create function public.record_pool_tranche_released(p_tranche uuid, p_ref text, p_amount bigint, p_idem text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare t public.pool_tranches; v_amt bigint;
begin
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then
    select released_minor into v_amt from public.pool_tranches where id = p_tranche; return v_amt;
  end if;
  select * into t from public.pool_tranches where id = p_tranche for update;
  if t.status <> 'verified' then perform public.l2_fail('tranche_state', format('Milestone is %s, expected verified.', t.status)); end if;
  perform 1 from public.pools where id = t.pool_id and status in ('funded', 'matured') for update;
  if not found then perform public.l2_fail('pool_not_funded', 'Only a funded Pool can release money.'); end if;
  if exists (select 1 from public.pool_tranches where pool_id = t.pool_id and seq < t.seq and status <> 'released') then
    perform public.l2_fail('earlier_tranche_pending', 'Earlier milestones must be released first.');
  end if;
  v_amt := public.pool_tranche_release_amount(t.id);
  if v_amt <> p_amount then perform public.l2_fail('payout_amount_mismatch', format('Provider disbursed %s, owed %s.', p_amount, v_amt)); end if;
  perform public.ledger_post_pool('pool_tranche.released', p_idem, t.pool_id, jsonb_build_array(
    jsonb_build_object('kind', 'pool_issuer_payable', 'amount', v_amt),
    jsonb_build_object('kind', 'pool_escrow', 'amount', -v_amt)
  ), null, p_ref, 'tranche ' || t.seq);
  update public.pool_tranches set status = 'released', released_minor = v_amt, released_at = now() where id = t.id;
  insert into public.audit_events (action, entity, entity_id, data) values ('pool_tranche.released', 'pool_tranche', t.id, jsonb_build_object('amount_minor', v_amt, 'ref', p_ref));
  return v_amt;
end $$;
