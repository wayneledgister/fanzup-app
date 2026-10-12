-- Layer 2 (CR-002) · offering workflow and money: Form C review, launch, issuer cap, Reg CF limit, Unit reservations,
-- fund moves into escrow (matching, strays), cancellation, reservation expiry, target-or-refund settlement, refunds,
-- milestone tranches, outbound ops. Design specs/l2/02-design.md §2–§5; 01a §2–3.
--
-- Rules every function here follows (design §2, §3, §4.2; PR #10 review rounds 1–5 and the final review):
--  * security definer, empty search_path, service_role only (0500);
--  * `l2_assert_enabled()` only on ENTRY paths (submit, review, collection execute, launch, reserve, tranche evidence and
--    verify); completion paths (confirmations, cancellation, expiry, settlement, refunds, releases) never check the flag;
--  * ONE clock: every money function takes `p_now` and decides liveness, expiry, cut-offs and windows from it, never
--    from now() / the transaction time;
--  * lock order investor profile → owner's artists (id order) → pool → investment(s) → tranche; functions that start from
--    an investment/tranche read its pool_id unlocked (it never changes), lock the pool, then the row; functions keyed by a
--    ledger idempotency key take their locks BEFORE checking the key (lock, then check);
--  * counter rule: raised_minor / investors_count count `funded` (+ `issued` after close); units_committed counts counted
--    reservations + funding + funded + issued; every function that moves an investment out of a counted state adjusts
--    the counters in the same transaction;
--  * counted reservation (design §3): status 'reserved' and (reserve_expires_at > now or provider_call_started_at set).

-- ── Outbound operations (two-phase, M1 pattern as on main; design §5 Outbound) ──
create table public.pool_ops (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'disburse', 'payout', 'close_offering')),
  subject_id uuid not null,                       -- investment | provider event (stray refund) | pool tranche | distribution payout | pool
  pool_id uuid not null references public.pools (id),
  fund_ref text,                                  -- set only for a stray fund-move refund (design §3.1)
  amount_minor bigint not null check (amount_minor >= 0),
  -- Unique and also the key sent to the provider: one key names exactly one money movement ever (design §5 key table).
  -- No unique (kind, subject_id): an investment refund and a stray refund never collide.
  idempotency_key text not null unique,
  status text not null default 'initiated' check (status in ('initiated', 'sent', 'confirmed', 'failed', 'dead')),
  provider_ref text,
  -- Fresh on every claim; every outcome write matches it, so a runner that outlived its lease can't overwrite the
  -- outcome of the runner that re-claimed the op (M1 inbox pattern).
  claim_token uuid,
  -- Set once, in the transaction just before the first provider call. Until then a disburse op's amount is re-derived;
  -- after it the amount is frozen (a changed amount fails the op `disburse_amount_changed`).
  call_started_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((fund_ref is not null) = (kind = 'refund' and idempotency_key like 'refund:fund:%'))
);
create index pool_ops_due_idx on public.pool_ops (next_attempt_at) where status = 'initiated';
create index pool_ops_pool_idx on public.pool_ops (pool_id, kind, status);
create trigger pool_ops_touch before update on public.pool_ops for each row execute function public.touch_updated_at();

-- One key scheme for every kind, built only here (design §5): refund:inv:<investment> | refund:fund:<fund_ref> |
-- disburse:<tranche> | payout:<distribution_payout> | close:<pool>. Re-queuing is harmless.
create function public.l2_op_key(p_kind text, p_subject uuid, p_fund_ref text default null) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'refund' and p_fund_ref is not null then 'refund:fund:' || p_fund_ref
    when p_kind = 'refund' then 'refund:inv:' || p_subject
    when p_kind = 'disburse' then 'disburse:' || p_subject
    when p_kind = 'payout' then 'payout:' || p_subject
    when p_kind = 'close_offering' then 'close:' || p_subject
  end
$$;

create function public.l2_queue_op(p_kind text, p_subject uuid, p_pool uuid, p_amount bigint, p_now timestamptz, p_fund_ref text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.pool_ops (kind, subject_id, pool_id, fund_ref, amount_minor, idempotency_key, next_attempt_at, created_at)
  values (p_kind, p_subject, p_pool, p_fund_ref, p_amount, public.l2_op_key(p_kind, p_subject, p_fund_ref), p_now, p_now)
  on conflict (idempotency_key) do nothing
$$;

-- Runner claim (design §5): due `initiated` ops, a 5-minute lease and a fresh claim_token each.
create function public.l2_claim_pool_ops(p_now timestamptz, p_limit integer default 20) returns setof public.pool_ops
language sql security definer set search_path = '' as $$
  update public.pool_ops o set claim_token = gen_random_uuid(), lease_until = p_now + interval '5 minutes'
   where o.id in (select id from public.pool_ops
                   where status = 'initiated' and next_attempt_at <= p_now and (lease_until is null or lease_until < p_now)
                   order by next_attempt_at, id limit p_limit for update skip locked)
  returning o.*
$$;

-- Just before the first provider call (design §5 "Never a stale amount"): under the pool lock and only for the claimant,
-- re-derive a disburse op's amount and set call_started_at in the same transaction. Once a call has started the amount
-- is frozen: if what is owed now differs the op fails `disburse_amount_changed` instead of sending a stale figure.
-- Returns (amount_minor, outcome): outcome 'call' (send amount_minor), 'not_claimed', 'not_initiated',
-- 'earlier_tranche_pending', 'nothing_owed', 'disburse_amount_changed'.
create function public.l2_op_start_call(p_op uuid, p_claim uuid, p_now timestamptz)
returns table (amount_minor bigint, outcome text) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_pool uuid; o public.pool_ops; t public.pool_tranches; v_owed bigint;
begin
  select pool_id into v_pool from public.pool_ops where id = p_op;
  if not found then perform public.l2_fail('op_not_found', 'No such operation.'); end if;
  perform 1 from public.pools where id = v_pool for update;
  select * into o from public.pool_ops where id = p_op for update;
  if o.claim_token is distinct from p_claim then return query select o.amount_minor, 'not_claimed'::text; return; end if;
  if o.status <> 'initiated' then return query select o.amount_minor, 'not_initiated'::text; return; end if;
  if o.kind = 'disburse' then
    select * into t from public.pool_tranches where id = o.subject_id for update;
    if exists (select 1 from public.pool_tranches where pool_id = t.pool_id and seq < t.seq and status <> 'released') then
      return query select o.amount_minor, 'earlier_tranche_pending'::text; return;
    end if;
    v_owed := public.pool_tranche_release_amount(t.id);
    if o.call_started_at is null then
      if v_owed <= 0 then return query select 0::bigint, 'nothing_owed'::text; return; end if;
      update public.pool_ops set amount_minor = v_owed, call_started_at = p_now where id = o.id and claim_token = p_claim;
      return query select v_owed, 'call'::text; return;
    end if;
    if v_owed <> o.amount_minor then
      update public.pool_ops set status = 'failed', last_error = 'disburse_amount_changed', lease_until = null
       where id = o.id and claim_token = p_claim;
      insert into public.audit_events (action, entity, entity_id, data)
      values ('pool_op.disburse_amount_changed', 'pool_op', o.id, jsonb_build_object('sent_minor', o.amount_minor, 'owed_minor', v_owed));
      return query select o.amount_minor, 'disburse_amount_changed'::text; return;
    end if;
    return query select o.amount_minor, 'call'::text; return;
  end if;
  update public.pool_ops set call_started_at = coalesce(call_started_at, p_now) where id = o.id and claim_token = p_claim;
  return query select o.amount_minor, 'call'::text;
end $$;

-- ── Notices (design §5.2): the l2.notify outbox, deduplicated where a notice must be sent once ──
create table public.l2_notice_keys (
  dedupe_key text primary key,
  created_at timestamptz not null default now()
);
-- Queues one l2.notify outbox row; with a dedupe key, at most once ever (insert … on conflict do nothing).
create function public.l2_notify(p_template text, p_payload jsonb, p_dedupe text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_dedupe is not null then
    insert into public.l2_notice_keys (dedupe_key) values (p_dedupe) on conflict do nothing;
    if not found then return false; end if;
  end if;
  insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', p_template) || coalesce(p_payload, '{}'));
  return true;
end $$;

create function public.l2_owner(p_pool uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select a.owner_id from public.pools p join public.artists a on a.id = p.artist_id where p.id = p_pool
$$;

-- ── Issuer cap (design §4.1): aggregated by OWNER (every artist row of the Pool's owner), on the maximum ──
-- Locks every artist row of the owner in id order (lock order: … → artists → pool). Call before locking the Pool.
create function public.l2_lock_owner_artists(p_pool uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  v_owner := public.l2_owner(p_pool);
  if v_owner is null then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  perform 1 from public.artists where owner_id = v_owner order by id for update;
  return v_owner;
end $$;

-- Remaining 12-month cap for this Pool: tier cap (never above POLICY.regCf.issuerCapMinor) − attested other Reg CF
-- sales − Σ over the owner's OTHER Pools (raised for those closed in the trailing 12 months, max for in_review /
-- approved / live). Caller holds the owner's artist locks.
create function public.l2_issuer_cap_remaining(p_pool uuid, p_other bigint, p_now timestamptz) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := public.l2_owner(p_pool); v_tier_cap bigint; v_sum bigint;
begin
  select least(tl.reg_cf_cap_minor, (select (value ->> 'issuer_cap_minor')::bigint from public.platform_settings where key = 'regcf_limits'))
    into v_tier_cap
    from public.pools p join public.artists a on a.id = p.artist_id join public.tier_limits tl on tl.tier = a.tier where p.id = p_pool;
  if v_tier_cap is null then return null; end if;
  select coalesce(sum(case when x.status in ('funded', 'matured') then x.raised_minor else x.max_minor end), 0) into v_sum
    from public.pools x join public.artists a on a.id = x.artist_id
   where a.owner_id = v_owner and x.id <> p_pool
     and (x.status in ('in_review', 'approved', 'live')
          or (x.status in ('funded', 'matured') and x.closed_at > p_now - interval '12 months'));
  return v_tier_cap - coalesce(p_other, 0) - v_sum;
end $$;

-- ── Workflow ───────────────────────────────────────────────────────────
-- Submit for Form C review (FR-L2-CR-001…005). The API generates the mock Form C and passes it with its hash, plus the
-- creator's attested other Reg CF sales in the preceding 12 months (self-reported, pending counsel — L2-Q12).
create function public.submit_pool(p_pool uuid, p_user uuid, p_form_c jsonb, p_sha256 text, p_other_regcf_12m_minor bigint, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.pools; a public.artists; v_cap bigint; v_remaining bigint; v_funds bigint; v_pct int; v_n int; v_doc uuid; v_ver int; m public.collection_mechanisms;
begin
  perform public.l2_assert_enabled();
  if public.l2_owner(p_pool) is distinct from p_user then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  perform public.l2_lock_owner_artists(p_pool);
  select * into p from public.pools where id = p_pool for update;
  if p.status not in ('draft', 'revisions_requested') then perform public.l2_fail('pool_not_editable', format('This Pool is %s and can''t be submitted.', p.status)); end if;
  if p_other_regcf_12m_minor is null or p_other_regcf_12m_minor < 0 then
    perform public.l2_fail('attestation_required', 'Tell us your other Reg CF sales in the last 12 months (enter 0 if none).');
  end if;
  select * into a from public.artists where id = p.artist_id;
  -- PRD 01 §6.3: Starter has no Reg CF access; the tier is assessed here, at submission.
  select reg_cf_cap_minor into v_cap from public.tier_limits where tier = a.tier;
  if v_cap is null then perform public.l2_fail('tier_not_eligible', 'Revenue-share Pools open at Rising tier. Starter creators can run reward campaigns.'); end if;
  if a.identity_status <> 'verified' then perform public.l2_fail('identity_required', 'Verify your identity before submitting a Pool.'); end if;
  if p.duration_days < (select (value ->> 'min_offering_days')::int from public.platform_settings where key = 'regcf_limits') then
    perform public.l2_fail('duration_too_short', 'A Pool must stay open for at least 21 days.');
  end if;
  v_remaining := public.l2_issuer_cap_remaining(p.id, p_other_regcf_12m_minor, p_now);
  if p.max_minor > v_remaining then
    perform public.l2_fail('tier_cap_exceeded', format('You can raise up to %s more in Reg CF offerings in the next 12 months; this Pool''s maximum is %s.',
      public.l2_usd(greatest(v_remaining, 0)), public.l2_usd(p.max_minor)));
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
  insert into public.pool_documents (pool_id, kind, version, body, sha256, created_at) values (p.id, 'form_c', v_ver, p_form_c, p_sha256, p_now) returning id into v_doc;
  update public.collection_mechanisms set mechanism = p.collection_mechanism, revenue_types = p.revenue_types,
         badge = public.l2_risk_badge(p.collection_mechanism, p.revenue_types)
   where pool_id = p.id and status = 'submitted';
  update public.pools set status = 'in_review', tier_at_submission = a.tier, cap_minor_at_submission = v_cap, form_c_document_id = v_doc,
         risk_badge = public.l2_risk_badge(p.collection_mechanism, p.revenue_types),
         issuer_other_regcf_12m_minor = p_other_regcf_12m_minor, issuer_other_regcf_attested_at = p_now,
         terms_sha256 = public.l2_pool_terms_hash(p.id)
   where id = p.id;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'pool.submitted', 'pool', p.id, jsonb_build_object('tier', a.tier, 'target_minor', p.target_minor, 'max_minor', p.max_minor,
          'form_c_sha256', p_sha256, 'other_regcf_12m_minor', p_other_regcf_12m_minor, 'cap_remaining_minor', v_remaining));
  return v_doc;
end $$;

-- Form C review (staff). Reviewer ≠ owner (FR-ID-003). Approval refuses if the terms changed since submission.
create function public.review_pool(p_pool uuid, p_reviewer uuid, p_decision text, p_notes text, p_now timestamptz) returns void
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
  if p_decision = 'approved' and p.terms_sha256 is distinct from public.l2_pool_terms_hash(p.id) then
    perform public.l2_fail('terms_changed', 'The Pool''s terms changed after it was submitted. Ask the creator to resubmit.');
  end if;
  select sha256 into v_sha from public.pool_documents where id = p.form_c_document_id;
  update public.pools set status = p_decision::public.pool_status where id = p.id;
  insert into public.pool_reviews (pool_id, reviewer_id, decision, notes, form_c_sha256, created_at) values (p.id, p_reviewer, p_decision, p_notes, v_sha, p_now);
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_reviewer, 'pool.reviewed', 'pool', p.id, jsonb_build_object('decision', p_decision, 'form_c_sha256', v_sha));
end $$;

-- Staff execute the collection-mechanism record (01b AC-R6). Executor ≠ owner.
create function public.execute_collection_mechanism(p_pool uuid, p_staff uuid, p_details jsonb, p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.l2_assert_enabled();
  if public.l2_owner(p_pool) = p_staff then perform public.l2_fail('reviewer_is_owner', 'You can''t execute a Pool you own.'); end if;
  perform 1 from public.pools where id = p_pool for update;
  update public.collection_mechanisms
     set status = 'executed', executed_by = p_staff, executed_at = p_now, details = details || coalesce(p_details, '{}')
   where pool_id = p_pool and status = 'submitted';
  if not found then perform public.l2_fail('collection_not_submitted', 'There''s no submitted collection mechanism to execute.'); end if;
  insert into public.audit_events (actor_id, action, entity, entity_id) values (p_staff, 'pool.collection_executed', 'pool', p_pool);
end $$;

-- Creator launches: provider issuer/offering/collection account already exist (refs passed in). Re-checks the issuer cap
-- on the maximum under the owner's artist locks with the re-attested outside figure, stores the remaining cap, refuses a
-- deadline under 21 days and terms changed since submission. The clock starts at p_now.
create function public.launch_pool(p_pool uuid, p_user uuid, p_issuer_ref text, p_offering_ref text, p_collection_ref text,
  p_legal_name text, p_other_regcf_12m_minor bigint, p_now timestamptz)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare p public.pools; v_issuer uuid; v_ends timestamptz; v_remaining bigint;
begin
  perform public.l2_assert_enabled();
  if public.l2_owner(p_pool) is distinct from p_user then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  perform public.l2_lock_owner_artists(p_pool);
  select * into p from public.pools where id = p_pool for update;
  if p.status <> 'approved' then perform public.l2_fail('pool_not_approved', 'A Pool must pass Form C review before it can go live.'); end if;
  if p.terms_sha256 is distinct from public.l2_pool_terms_hash(p.id) then
    perform public.l2_fail('terms_changed', 'The Pool''s terms changed after it was reviewed. Resubmit it for review.');
  end if;
  if p.duration_days < (select (value ->> 'min_offering_days')::int from public.platform_settings where key = 'regcf_limits') then
    perform public.l2_fail('duration_too_short', 'A Pool must stay open for at least 21 days.');
  end if;
  if not exists (select 1 from public.collection_mechanisms where pool_id = p.id and status = 'executed') then
    perform public.l2_fail('collection_not_executed', 'The collection agreement must be executed before the Pool can go live.');
  end if;
  if p_other_regcf_12m_minor is null or p_other_regcf_12m_minor < 0 then
    perform public.l2_fail('attestation_required', 'Confirm your other Reg CF sales in the last 12 months (enter 0 if none).');
  end if;
  v_remaining := public.l2_issuer_cap_remaining(p.id, p_other_regcf_12m_minor, p_now);
  if v_remaining is null or p.max_minor > v_remaining then
    perform public.l2_fail('tier_cap_exceeded', format('You can raise up to %s more in Reg CF offerings in the next 12 months; this Pool''s maximum is %s.',
      public.l2_usd(greatest(coalesce(v_remaining, 0), 0)), public.l2_usd(p.max_minor)));
  end if;
  insert into public.issuers (artist_id, legal_name, provider_issuer_ref) values (p.artist_id, p_legal_name, p_issuer_ref)
  on conflict (artist_id) do update set provider_issuer_ref = coalesce(public.issuers.provider_issuer_ref, excluded.provider_issuer_ref)
  returning id into v_issuer;
  v_ends := p_now + make_interval(days => p.duration_days);
  update public.pools set status = 'live', issuer_id = v_issuer, provider_offering_ref = p_offering_ref, provider_collection_ref = p_collection_ref,
         starts_at = p_now, ends_at = v_ends, issuer_cap_remaining_minor = v_remaining,
         issuer_other_regcf_12m_minor = p_other_regcf_12m_minor, issuer_other_regcf_attested_at = p_now
   where id = p.id;
  insert into public.revenue_sources (pool_id, revenue_type, kind, name)
  select p.id, t, case p.collection_mechanism when 'LOCKBOX' then 'lockbox' when 'SELF_REPORT' then 'self_report'
                       when 'SPLIT_PAYEE' then 'split_payee' when 'LETTER_OF_DIRECTION' then 'letter_of_direction' else 'distributor' end,
         case t when 'master' then 'Distributor (mock)' when 'sync' then 'Sync licensing (mock)' else 'Publishing / PRO (mock)' end
    from unnest(p.revenue_types) t
  on conflict (pool_id, revenue_type) do nothing;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'pool.launched', 'pool', p.id, jsonb_build_object('offering_ref', p_offering_ref, 'ends_at', v_ends,
          'other_regcf_12m_minor', p_other_regcf_12m_minor, 'cap_remaining_minor', v_remaining));
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

-- The one definition of a counted reservation (design §3): its headroom and Units stay counted while a provider call
-- may have moved money.
create function public.l2_counted_reservation(p_status public.investment_status, p_expires timestamptz, p_call_started timestamptz, p_now timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select p_status = 'reserved' and (p_expires > p_now or p_call_started is not null)
$$;

-- Usage over the trailing 12 months: counted reservations + funding + funded + issued + refund_pending, plus
-- self-reported elsewhere (FR-L2-INV-003).
create function public.regcf_usage(p_user uuid, p_now timestamptz) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(i.amount_minor) from public.investments i
                    where i.investor_id = p_user and i.created_at > p_now - interval '12 months'
                      and (i.status in ('funding', 'funded', 'issued', 'refund_pending')
                           or public.l2_counted_reservation(i.status, i.reserve_expires_at, i.provider_call_started_at, p_now))), 0)::bigint
       + coalesce((select elsewhere_12m_minor from public.investor_profiles where user_id = p_user), 0)
$$;

-- ── Reserve Units (AC-I1 / I2 / I5): one transaction; investor row locked, then the Pool row. ──
create function public.reserve_investment(p_user uuid, p_pool uuid, p_units integer, p_ack_version text, p_now timestamptz)
returns table (investment_id uuid, amount_minor bigint, reserve_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare ip public.investor_profiles; p public.pools; v_amount bigint; v_limit bigint; v_used bigint; v_id uuid; v_exp timestamptz; v_pool_committed bigint;
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
  -- Issuer-cap backstop (design §4.1; a defensive invariant): counted reservations + funding + funded never past the cap.
  select coalesce(sum(i.amount_minor), 0) into v_pool_committed from public.investments i
   where i.pool_id = p.id and (i.status in ('funding', 'funded')
         or public.l2_counted_reservation(i.status, i.reserve_expires_at, i.provider_call_started_at, p_now));
  if p.issuer_cap_remaining_minor is null or v_pool_committed + v_amount > p.issuer_cap_remaining_minor then
    perform public.l2_fail('issuer_cap_reached', format('This Pool can take only %s more under the creator''s 12-month limit.',
      public.l2_usd(greatest(coalesce(p.issuer_cap_remaining_minor, 0) - v_pool_committed, 0))));
  end if;
  v_limit := public.regcf_investor_limit(p_user);
  v_used := public.regcf_usage(p_user, p_now);
  if v_limit is not null and v_used + v_amount > v_limit then
    perform public.l2_fail('regcf_limit_exceeded', format('That''s over your 12-month investment limit. You have %s left.', public.l2_usd(greatest(0, v_limit - v_used))));
  end if;
  v_exp := p_now + make_interval(mins => (public.l2_policy('reserve_minutes') #>> '{}')::int);
  insert into public.investments (pool_id, investor_id, units, unit_price_minor, amount_minor, cap_minor, status, reserve_expires_at,
                                  risk_ack_version, risk_ack_at, created_at)
  values (p.id, p_user, p_units, p.unit_price_minor, v_amount, (v_amount * p.return_cap_bps) / 10000, 'reserved', v_exp, p_ack_version, p_now, p_now)
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

-- The one liveness predicate (design §5): a reservation can become a commitment only while it is unexpired, has no
-- pending cancellation and its Pool is live before the deadline. Shared by mark_investment_funding and the applied
-- path of record_investment_funded.
create function public.l2_reservation_live(i public.investments, p public.pools, p_now timestamptz) returns boolean
language sql immutable set search_path = '' as $$
  select i.status = 'reserved' and i.reserve_expires_at > p_now and i.cancel_requested_at is null
     and p.status = 'live' and p.ends_at is not null and p_now < p.ends_at
$$;

-- Cancel-by time for the 227.303(d) commitment notice: deadline − cancel cut-off.
create function public.l2_cancel_by(p public.pools) returns timestamptz language sql stable set search_path = '' as $$
  select p.ends_at - make_interval(hours => (public.l2_policy('cancel_cutoff_hours') #>> '{}')::int)
$$;

-- 227.303(d) commitment notice, once per investment (dedupe commitment_received:<investment>), from whichever path
-- records the commitment first (design §5.2).
create function public.l2_notify_commitment(i public.investments, p public.pools) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.l2_notify('commitment_received', jsonb_build_object(
    'investment_id', i.id, 'user_id', i.investor_id, 'pool_id', p.id, 'amount_minor', i.amount_minor,
    'unit_price_minor', i.unit_price_minor, 'units', i.units,
    'issuer_name', coalesce((select legal_name from public.issuers where id = p.issuer_id), p.artist_display),
    'issuer_name_pending', 'L2-Q2', 'cancel_by', public.l2_cancel_by(p)), 'commitment_received:' || i.id);
end $$;

-- Refs found by a provider lookup (design §4.3, §5 guard (e)): stored without changing status.
create function public.record_investment_provider_refs(p_inv uuid, p_trade_ref text, p_fund_ref text, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; i public.investments;
begin
  select pool_id into v_pool from public.investments where id = p_inv;
  if not found then perform public.l2_fail('investment_not_found', 'No such investment.'); end if;
  perform 1 from public.pools where id = v_pool for update;
  select * into i from public.investments where id = p_inv for update;
  if (p_trade_ref is not null and i.provider_trade_ref is not null and i.provider_trade_ref <> p_trade_ref)
     or (p_fund_ref is not null and i.provider_fund_ref is not null and i.provider_fund_ref <> p_fund_ref) then
    perform public.l2_fail('provider_ref_conflict', 'The provider reports a different trade or fund move for this investment.');
  end if;
  update public.investments set provider_trade_ref = coalesce(provider_trade_ref, p_trade_ref), provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref)
   where id = i.id;
  insert into public.audit_events (action, entity, entity_id, data)
  values ('investment.provider_refs', 'investment', i.id, jsonb_build_object('trade_ref', p_trade_ref, 'fund_ref', p_fund_ref, 'status', i.status));
  return i.status::text;
end $$;

-- Trade + fund move created at the provider (design §5 Purchase). Moves reserved → funding only for a live reservation
-- (l2_reservation_live) and queues the commitment notice; a reserved-but-dead row keeps its status (still counted: a
-- call started) and returns 'dead'; a row that already moved on returns its current status (resume-guard cases (a)/(a′)).
create function public.mark_investment_funding(p_inv uuid, p_trade_ref text, p_fund_ref text, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; i public.investments; p public.pools;
begin
  select pool_id into v_pool from public.investments where id = p_inv;
  if not found then perform public.l2_fail('investment_not_found', 'No such investment.'); end if;
  select * into p from public.pools where id = v_pool for update;
  select * into i from public.investments where id = p_inv for update;
  update public.investments set provider_trade_ref = coalesce(provider_trade_ref, p_trade_ref), provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref)
   where id = i.id;
  if i.status <> 'reserved' then return i.status::text; end if;
  if not public.l2_reservation_live(i, p, p_now) then
    insert into public.audit_events (action, entity, entity_id, data) values ('investment.funding_dead', 'investment', i.id, jsonb_build_object('fund_ref', p_fund_ref));
    return 'dead';
  end if;
  update public.investments set status = 'funding' where id = i.id;
  perform public.l2_notify_commitment(i, p);
  return 'funding';
end $$;

-- ── Fund-move matching (design §3.1) ───────────────────────────────────
-- Fund move settled into the offering escrow, matched to p_inv by the caller (fund ref first, then externalId).
-- Lock pool → investment, then check the key. Returns 'duplicate', 'stray' (the caller hands it to record_stray_fund_move:
-- a different fund ref, or a fund move was already received for this investment), 'applied',
-- 'refund:cancelled_by_investor' or 'refund:<reason>' (unapplied: reservation_expired, reservation_cancelled,
-- offering_closed, amount_mismatch). Every non-stray path posts the fund move once and stores the received amount.
create function public.record_investment_funded(p_inv uuid, p_fund_ref text, p_amount bigint, p_idem text, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; i public.investments; p public.pools; v_reason text; v_counted boolean;
begin
  select pool_id into v_pool from public.investments where id = p_inv;
  if not found then perform public.l2_fail('investment_not_found', 'No investment for this fund move.'); end if;
  select * into p from public.pools where id = v_pool for update;
  select * into i from public.investments where id = p_inv for update;
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  if p_amount is null or p_amount <= 0 then perform public.l2_fail('invalid_amount', 'A fund move must be positive.'); end if;
  if (i.provider_fund_ref is not null and i.provider_fund_ref <> p_fund_ref)
     or i.funded_received_minor is not null
     or i.status in ('funded', 'issued', 'refund_pending', 'refunded', 'returned') then
    return 'stray';
  end if;
  perform public.ledger_post_pool('investment.funded', p_idem, p.id, jsonb_build_array(
    jsonb_build_object('kind', 'pool_escrow', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_investor_liability', 'amount', -p_amount)
  ), i.id, p_fund_ref, null);

  -- Applied: a live reservation, or a funding investment with no pending cancel on a Pool not yet settled; exact amount.
  if p_amount = i.amount_minor
     and (public.l2_reservation_live(i, p, p_now) or (i.status = 'funding' and i.cancel_requested_at is null and p.status = 'live')) then
    update public.investments set status = 'funded', funded_at = p_now, funded_received_minor = p_amount,
           provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref) where id = i.id;
    update public.pools set raised_minor = raised_minor + p_amount where id = p.id;
    perform public.l2_recount_investors(p.id);
    if i.status = 'reserved' then perform public.l2_notify_commitment(i, p); end if;
    perform public.l2_notify('investment_funded', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id, 'amount_minor', p_amount));
    insert into public.audit_events (action, entity, entity_id, data) values ('investment.funded', 'investment', i.id, jsonb_build_object('amount_minor', p_amount));
    return 'applied';
  end if;

  v_counted := i.status in ('reserved', 'funding');
  v_reason := case
    when i.cancel_requested_at is not null and v_counted then 'cancelled_by_investor'
    when i.status = 'cancelled' then 'reservation_cancelled'
    when p.status <> 'live' or p_now >= p.ends_at then 'offering_closed'
    when i.status = 'expired' or (i.status = 'reserved' and not public.l2_reservation_live(i, p, p_now)) then 'reservation_expired'
    else 'amount_mismatch' end;
  -- Counter rule: Units leave units_committed if they were still counted; raised_minor never changes.
  if v_counted then update public.pools set units_committed = units_committed - i.units where id = p.id; end if;
  update public.investments set status = 'refund_pending', status_reason = v_reason, funded_received_minor = p_amount,
         provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref),
         cancelled_at = case when v_reason = 'cancelled_by_investor' then p_now else cancelled_at end
   where id = i.id;
  perform public.l2_queue_op('refund', i.id, p.id, p_amount, p_now);
  if v_reason = 'cancelled_by_investor' then
    perform public.l2_notify('investment_cancelled', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id,
      'reason', 'cancelled_at_your_request', 'refund_minor', p_amount), 'investment_cancelled:' || i.id);
  else
    perform public.l2_notify('payment_refunded_unapplied', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id,
      'reason', v_reason, 'refund_minor', p_amount), 'payment_refunded_unapplied:' || i.id);
  end if;
  if v_reason = 'amount_mismatch' then
    insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs, opened_at)
    values (p.id, 'unapplied_funding', 'unapplied_funding:' || i.id, p_amount,
            jsonb_build_object('investment_id', i.id, 'reason', v_reason, 'expected_minor', i.amount_minor, 'received_minor', p_amount), p_now)
    on conflict do nothing;
  end if;
  insert into public.audit_events (action, entity, entity_id, data) values ('investment.funding_unapplied', 'investment', i.id, jsonb_build_object('reason', v_reason, 'amount_minor', p_amount));
  return 'refund:' || v_reason;
end $$;

-- Stray fund moves (design §3.1 step 4): posted once, no investment state or counter changes, own refund op keyed by
-- the fund ref. Serialised on an advisory lock on the fund ref, after the pool lock.
create table public.pool_stray_fund_moves (
  fund_ref text primary key,
  pool_id uuid not null references public.pools (id),
  investment_id uuid references public.investments (id),   -- the investment the event named, if any (informational)
  event_id uuid,                                            -- provider_events row (subject of the refund op)
  amount_minor bigint not null check (amount_minor > 0),
  received_at timestamptz not null,
  refund_ref text,
  refunded_at timestamptz
);
create index pool_stray_open_idx on public.pool_stray_fund_moves (pool_id) where refunded_at is null;

create function public.record_stray_fund_move(p_pool uuid, p_fund_ref text, p_amount bigint, p_event uuid, p_inv uuid, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_idem text := 'fund:' || p_fund_ref;
begin
  perform 1 from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No Pool for this fund move.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('l2.fund:' || p_fund_ref, 0));
  if exists (select 1 from public.ledger_transactions where idempotency_key = v_idem) then return 'duplicate'; end if;
  if p_amount is null or p_amount <= 0 then perform public.l2_fail('invalid_amount', 'A fund move must be positive.'); end if;
  perform public.ledger_post_pool('investment.funded_stray', v_idem, p_pool, jsonb_build_array(
    jsonb_build_object('kind', 'pool_escrow', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_investor_liability', 'amount', -p_amount)
  ), null, p_fund_ref, 'stray fund move');
  insert into public.pool_stray_fund_moves (fund_ref, pool_id, investment_id, event_id, amount_minor, received_at)
  values (p_fund_ref, p_pool, p_inv, p_event, p_amount, p_now);
  perform public.l2_queue_op('refund', coalesce(p_event, p_pool), p_pool, p_amount, p_now, p_fund_ref);
  insert into public.audit_events (action, entity, entity_id, data)
  values ('fund_move.stray', 'pool', p_pool, jsonb_build_object('fund_ref', p_fund_ref, 'amount_minor', p_amount, 'investment_id', p_inv));
  return 'stray';
end $$;

-- Pool `failed → refunded` only when nothing is left to refund or resolve (design §3 Pool status): no refund_pending or
-- funding investment, no reservation left (every remaining one on a settled Pool is counted: a call started), no open
-- stray fund move. Caller holds the pool lock.
create function public.l2_maybe_mark_refunded(p_pool uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.pools where id = p_pool) <> 'failed' then return false; end if;
  if exists (select 1 from public.investments where pool_id = p_pool and status in ('refund_pending', 'funding', 'reserved'))
     or exists (select 1 from public.pool_stray_fund_moves where pool_id = p_pool and refunded_at is null) then
    return false;
  end if;
  update public.pools set status = 'refunded' where id = p_pool;
  insert into public.audit_events (action, entity, entity_id) values ('pool.refunded', 'pool', p_pool);
  return true;
end $$;

create function public.record_stray_fund_refund_confirmed(p_fund_ref text, p_refund_ref text, p_amount bigint, p_idem text, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.pool_stray_fund_moves; v_pool uuid;
begin
  select pool_id into v_pool from public.pool_stray_fund_moves where fund_ref = p_fund_ref;
  if not found then perform public.l2_fail('stray_not_found', 'No stray fund move with that reference.'); end if;
  perform 1 from public.pools where id = v_pool for update;
  perform pg_advisory_xact_lock(hashtextextended('l2.fund:' || p_fund_ref, 0));
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  select * into s from public.pool_stray_fund_moves where fund_ref = p_fund_ref for update;
  if s.refunded_at is not null then return 'duplicate'; end if;
  if p_amount is distinct from s.amount_minor then
    perform public.l2_fail('refund_amount_mismatch', format('The provider refunded %s; %s arrived.', public.l2_usd(p_amount), public.l2_usd(s.amount_minor)));
  end if;
  perform public.ledger_post_pool('investment.stray_refunded', p_idem, s.pool_id, jsonb_build_array(
    jsonb_build_object('kind', 'pool_investor_liability', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_escrow', 'amount', -p_amount)
  ), null, p_refund_ref, 'stray fund move refunded');
  update public.pool_stray_fund_moves set refund_ref = p_refund_ref, refunded_at = p_now where fund_ref = p_fund_ref;
  perform public.l2_maybe_mark_refunded(s.pool_id);
  insert into public.audit_events (action, entity, entity_id, data)
  values ('fund_move.stray_refunded', 'pool', s.pool_id, jsonb_build_object('fund_ref', p_fund_ref, 'refund_ref', p_refund_ref, 'amount_minor', p_amount));
  return 'applied';
end $$;

-- Fund move returned by the bank (e.g. R01). No money arrived: reserved/funding → returned, Units and limit headroom
-- back in this transaction (AC-I2). Stores the fund ref (coalesce) so recon can match the provider's returned move.
create function public.record_investment_returned(p_inv uuid, p_fund_ref text, p_code text, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; i public.investments;
begin
  select pool_id into v_pool from public.investments where id = p_inv;
  if not found then perform public.l2_fail('investment_not_found', 'No investment for this fund move.'); end if;
  perform 1 from public.pools where id = v_pool for update;
  select * into i from public.investments where id = p_inv for update;
  if i.status not in ('reserved', 'funding') then return 'ignored'; end if;
  if i.provider_fund_ref is not null and p_fund_ref is not null and i.provider_fund_ref <> p_fund_ref then return 'ignored'; end if;
  update public.investments set status = 'returned', status_reason = coalesce(p_code, 'returned'),
         provider_fund_ref = coalesce(provider_fund_ref, p_fund_ref) where id = i.id;
  update public.pools set units_committed = units_committed - i.units where id = i.pool_id;
  perform public.l2_notify('funding_returned', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id, 'code', p_code), 'funding_returned:' || i.id);
  perform public.l2_maybe_mark_refunded(i.pool_id);
  insert into public.audit_events (action, entity, entity_id, data) values ('investment.returned', 'investment', i.id, jsonb_build_object('code', p_code, 'fund_ref', p_fund_ref));
  return 'returned';
end $$;

-- ── Reservation expiry (design §4.3) ───────────────────────────────────
-- What the expiry step may do with a reservation now: null (nothing), 'expire' (no provider call was ever made: resolve
-- at once) or 'lookup' (a call started: only after the lookup grace, and only once the API's provider lookup confirms
-- no trade or a voided trade). Rows whose fund ref is stored are skipped (they await their fund-move event, §3.1).
create function public.l2_expiry_action(i public.investments, p public.pools, p_now timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when i.status <> 'reserved' or i.provider_fund_ref is not null then null
    when not (i.reserve_expires_at <= p_now or p.status <> 'live' or p_now >= p.ends_at or i.cancel_requested_at is not null) then null
    when i.provider_call_started_at is null then 'expire'
    when p_now >= coalesce(i.cancel_requested_at, least(i.reserve_expires_at, p.ends_at))
                  + make_interval(mins => (public.l2_policy('expiry_lookup_grace_minutes') #>> '{}')::int) then 'lookup'
    else null end
$$;

-- Worker input (API `expireReservations`): every reservation the step should act on at p_now.
create function public.l2_expiry_candidates(p_now timestamptz)
returns table (investment_id uuid, pool_id uuid, action text, cancel_pending boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, i.pool_id, public.l2_expiry_action(i, p, p_now), i.cancel_requested_at is not null
    from public.investments i join public.pools p on p.id = i.pool_id
   where i.status = 'reserved' and i.provider_fund_ref is null and public.l2_expiry_action(i, p, p_now) is not null
   order by i.pool_id, i.id
$$;

-- Resolve reservations of one Pool (pool lock, then its rows in id order), re-checking each under the lock. The caller
-- passes ids with action 'lookup' only after the provider confirmed no trade or a voided trade. Terminal state:
-- `cancelled` when a cancellation is pending (notice "nothing was charged"), else `expired`. Units and headroom freed here.
create function public.expire_investment_reservations(p_pool uuid, p_ids uuid[], p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare p public.pools; i public.investments; n integer := 0; v_to public.investment_status;
begin
  select * into p from public.pools where id = p_pool for update;
  if not found then return 0; end if;
  for i in select * from public.investments where pool_id = p_pool and id = any(p_ids) order by id for update loop
    if public.l2_expiry_action(i, p, p_now) is null then continue; end if;
    v_to := case when i.cancel_requested_at is not null then 'cancelled' else 'expired' end;
    update public.investments set status = v_to, cancelled_at = case when v_to = 'cancelled' then p_now else cancelled_at end,
           status_reason = case when v_to = 'cancelled' then 'cancelled_by_investor' else 'reservation_expired' end
     where id = i.id;
    update public.pools set units_committed = units_committed - i.units where id = p_pool;
    if v_to = 'cancelled' then
      perform public.l2_notify('investment_cancelled', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id,
        'reason', 'cancelled_at_your_request', 'refund_minor', 0, 'nothing_charged', true), 'investment_cancelled:' || i.id);
    end if;
    insert into public.audit_events (action, entity, entity_id, data) values ('investment.' || v_to::text, 'investment', i.id, jsonb_build_object('by', 'expiry_step'));
    n := n + 1;
  end loop;
  perform public.l2_maybe_mark_refunded(p_pool);
  return n;
end $$;

-- ── Investor cancellation (227.304(a); design §3 Cancellation). A completion path: no flag check. ──
-- Judged at request time against the 48-hour cut-off. Returns 'cancelled' or 'cancel_pending' (idempotent).
create function public.cancel_investment(p_inv uuid, p_user uuid, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; i public.investments; p public.pools;
begin
  select pool_id into v_pool from public.investments where id = p_inv and investor_id = p_user;
  if not found then perform public.l2_fail('investment_not_found', 'We couldn''t find that investment.'); end if;
  select * into p from public.pools where id = v_pool for update;
  select * into i from public.investments where id = p_inv for update;
  -- Repeats answer as the first request did.
  if i.status = 'cancelled' or (i.status in ('refund_pending', 'refunded') and i.status_reason = 'cancelled_by_investor') then return 'cancelled'; end if;
  if i.status in ('reserved', 'funding') and i.cancel_requested_at is not null then return 'cancel_pending'; end if;
  if p.status <> 'live' or p_now >= public.l2_cancel_by(p) then
    perform public.l2_fail('cancel_window_closed', 'Investments can be cancelled until 48 hours before the offering closes.');
  end if;
  if i.status = 'reserved' and i.provider_call_started_at is null then
    update public.investments set status = 'cancelled', cancelled_at = p_now, status_reason = 'cancelled_by_investor' where id = i.id;
    update public.pools set units_committed = units_committed - i.units where id = p.id;
    perform public.l2_notify('investment_cancelled', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id,
      'reason', 'cancelled_at_your_request', 'refund_minor', 0, 'nothing_charged', true), 'investment_cancelled:' || i.id);
    insert into public.audit_events (actor_id, action, entity, entity_id) values (p_user, 'investment.cancelled', 'investment', i.id);
    return 'cancelled';
  elsif i.status in ('reserved', 'funding') then
    -- A provider call started (reserved) or the fund move is in flight (funding): recorded now, resolved by the §4.3
    -- lookup or when the fund move settles (refund in full) or returns. Still counted until then.
    update public.investments set cancel_requested_at = p_now where id = i.id;
    perform public.l2_notify('cancel_pending', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id, 'status', i.status), 'cancel_pending:' || i.id);
    insert into public.audit_events (actor_id, action, entity, entity_id, data) values (p_user, 'investment.cancel_requested', 'investment', i.id, jsonb_build_object('status', i.status));
    return 'cancel_pending';
  elsif i.status = 'funded' then
    update public.investments set status = 'refund_pending', status_reason = 'cancelled_by_investor', cancelled_at = p_now where id = i.id;
    update public.pools set units_committed = units_committed - i.units, raised_minor = raised_minor - i.amount_minor where id = p.id;
    perform public.l2_recount_investors(p.id);
    perform public.l2_queue_op('refund', i.id, p.id, i.funded_received_minor, p_now);
    perform public.l2_notify('investment_cancelled', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id,
      'reason', 'cancelled_at_your_request', 'refund_minor', i.funded_received_minor), 'investment_cancelled:' || i.id);
    insert into public.audit_events (actor_id, action, entity, entity_id) values (p_user, 'investment.cancelled', 'investment', i.id);
    return 'cancelled';
  end if;
  perform public.l2_fail('not_cancellable', format('This investment is %s.', i.status));
  return null;
end $$;

-- ── Settlement at the deadline (AC-E2 target-or-refund; AC-E3 nothing to the issuer before close) ──
-- A completion path: runs with the flag off. Expires only reservations with no provider call; counted reservations
-- (call started) keep status, Units and headroom, are never issued nor part of the amount closed, and are resolved by
-- the §4.3 step (design §5 Settlement).
create function public.settle_pool(p_pool uuid, p_now timestamptz) returns public.pool_status
language plpgsql security definer set search_path = '' as $$
declare p public.pools; v_t1 uuid; r record; v_lock interval; v_raised bigint; v_units_sold integer;
begin
  select * into p from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No such Pool.'); end if;
  if p.status <> 'live' then return p.status; end if;
  if p_now < p.ends_at then perform public.l2_fail('not_due', 'The offering hasn''t reached its deadline.'); end if;
  -- Fund moves already in flight get a short grace period before the outcome is decided.
  if exists (select 1 from public.investments where pool_id = p.id and status = 'funding')
     and p_now < p.ends_at + make_interval(mins => (public.l2_policy('settle_grace_minutes') #>> '{}')::int) then
    return 'live';
  end if;
  for r in select id, units from public.investments where pool_id = p.id and status = 'reserved' and provider_call_started_at is null order by id for update loop
    update public.investments set status = 'expired', status_reason = 'reservation_expired' where id = r.id;
    update public.pools set units_committed = units_committed - r.units where id = p.id;
  end loop;
  select coalesce(sum(funded_received_minor), 0) into v_raised from public.investments where pool_id = p.id and status = 'funded';

  if v_raised >= p.target_minor and v_raised > 0 then
    perform public.ledger_post_pool('pool.closed', 'pool.closed:' || p.id, p.id, jsonb_build_array(
      jsonb_build_object('kind', 'pool_investor_liability', 'amount', v_raised),
      jsonb_build_object('kind', 'pool_issuer_payable', 'amount', -v_raised)
    ), null, p.provider_offering_ref, 'target met');
    v_lock := make_interval(months => (public.l2_policy('lockup_months') #>> '{}')::int);
    update public.investments set status = 'issued', issued_at = p_now, lockup_ends_at = p_now + v_lock where pool_id = p.id and status = 'funded';
    select coalesce(sum(units), 0) into v_units_sold from public.investments where pool_id = p.id and status = 'issued';
    update public.pools set status = 'funded', settled_at = p_now, closed_at = p_now, matures_at = p_now + make_interval(months => p.maturity_months),
           raised_minor = v_raised, units_issued = v_units_sold, collection_state = 'COLLECTING', collection_state_since = p_now
     where id = p.id;
    perform public.l2_recount_investors(p.id);
    update public.pool_tranches set status = 'verified', verified_at = p_now where pool_id = p.id and seq = 1 returning id into v_t1;
    perform public.l2_queue_op('close_offering', p.id, p.id, v_raised, p_now);
    if v_t1 is not null then perform public.l2_queue_op('disburse', v_t1, p.id, public.pool_tranche_release_amount(v_t1), p_now); end if;
    -- 227.303(f) transaction confirmation per issued investment (design §5.2; pending items labelled).
    for r in select i.* from public.investments i where i.pool_id = p.id and i.status = 'issued' order by i.id loop
      perform public.l2_notify('units_issued', jsonb_build_object(
        'investment_id', r.id, 'user_id', r.investor_id, 'pool_id', p.id, 'transaction_date', p_now,
        'security_type', 'revenue-share Units', 'security_type_pending', 'L2-Q2',
        'units', r.units, 'unit_price_minor', r.unit_price_minor, 'amount_minor', r.amount_minor,
        'offering_units_sold', v_units_sold, 'offering_unit_price_minor', p.unit_price_minor,
        'return_cap_bps', p.return_cap_bps, 'matures_at', p_now + make_interval(months => p.maturity_months), 'yield_pending', 'L2-Q9',
        'callable', false, 'platform_bps', p.platform_bps, 'fee_schedule_pending', 'L2-Q7', 'intermediary_compensation_pending', 'L2-Q3'),
        'units_issued:' || r.id);
    end loop;
    perform public.l2_notify('pool_funded', jsonb_build_object('pool_id', p.id, 'raised_minor', v_raised), 'pool_funded:' || p.id);
    insert into public.audit_events (action, entity, entity_id, data) values ('pool.settled', 'pool', p.id, jsonb_build_object('outcome', 'funded', 'raised_minor', v_raised));
    return 'funded';
  end if;

  -- Failed: every funded investment refunded in full from what arrived; counters adjusted now (counter rule).
  for r in select id, investor_id, funded_received_minor from public.investments where pool_id = p.id and status = 'funded' order by id for update loop
    update public.investments set status = 'refund_pending', status_reason = 'offering_failed' where id = r.id;
    perform public.l2_queue_op('refund', r.id, p.id, r.funded_received_minor, p_now);
  end loop;
  update public.pools set status = 'failed', settled_at = p_now, raised_minor = 0, investors_count = 0,
         units_committed = (select coalesce(sum(units), 0) from public.investments i
                             where i.pool_id = p.id and (i.status = 'funding'
                                   or public.l2_counted_reservation(i.status, i.reserve_expires_at, i.provider_call_started_at, p_now)))
   where id = p.id;
  -- 227.304(d): each investor is told the reason and the refund amount (design §5.2).
  for r in select investor_id, sum(funded_received_minor)::bigint as refund_minor from public.investments
            where pool_id = p.id and status = 'refund_pending' and status_reason = 'offering_failed' group by investor_id order by investor_id loop
    perform public.l2_notify('pool_failed', jsonb_build_object('pool_id', p.id, 'user_id', r.investor_id, 'reason', 'target_not_reached',
      'refund_minor', r.refund_minor, 'refund_within_business_days', (public.l2_policy('refund_direct_business_days') #>> '{}')::int),
      'pool_failed:' || p.id || ':' || r.investor_id);
  end loop;
  perform public.l2_maybe_mark_refunded(p.id);
  insert into public.audit_events (action, entity, entity_id, data) values ('pool.settled', 'pool', p.id, jsonb_build_object('outcome', 'failed', 'raised_minor', v_raised, 'target_minor', p.target_minor));
  return 'failed';
end $$;

-- Refund settled at the provider: the investor gets exactly what arrived (funded_received_minor).
create function public.record_investment_refunded(p_inv uuid, p_ref text, p_amount bigint, p_idem text, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; i public.investments;
begin
  select pool_id into v_pool from public.investments where id = p_inv;
  if not found then perform public.l2_fail('investment_not_found', 'No such investment.'); end if;
  perform 1 from public.pools where id = v_pool for update;
  select * into i from public.investments where id = p_inv for update;
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  if i.status <> 'refund_pending' then perform public.l2_fail('refund_state', format('Investment is %s; nothing to refund.', i.status)); end if;
  if p_amount is distinct from i.funded_received_minor then
    perform public.l2_fail('refund_amount_mismatch', format('The provider refunded %s; %s is owed.', public.l2_usd(p_amount), public.l2_usd(i.funded_received_minor)));
  end if;
  perform public.ledger_post_pool('investment.refunded', p_idem, v_pool, jsonb_build_array(
    jsonb_build_object('kind', 'pool_investor_liability', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_escrow', 'amount', -p_amount)
  ), i.id, p_ref, i.status_reason);
  update public.investments set status = 'refunded', refund_ref = p_ref, refunded_at = p_now where id = i.id;
  perform public.l2_maybe_mark_refunded(v_pool);
  perform public.l2_notify('refund_completed', jsonb_build_object('investment_id', i.id, 'user_id', i.investor_id, 'amount_minor', p_amount), 'refund_completed:' || i.id);
  insert into public.audit_events (action, entity, entity_id, data) values ('investment.refunded', 'investment', i.id, jsonb_build_object('amount_minor', p_amount, 'ref', p_ref));
  return 'applied';
end $$;

-- ── Milestone tranches (AC-E4; M1 rules, Pool-scoped; released strictly in order) ──
create function public.pool_tranche_release_amount(p_tranche uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare t public.pool_tranches; v_payable bigint; v_raised bigint;
begin
  select * into t from public.pool_tranches where id = p_tranche;
  v_payable := -public.pool_balance('pool_issuer_payable', t.pool_id);
  -- The last tranche is owed whatever pool_issuer_payable still holds.
  if not exists (select 1 from public.pool_tranches where pool_id = t.pool_id and seq > t.seq) then return v_payable; end if;
  select raised_minor into v_raised from public.pools where id = t.pool_id;
  return least(v_payable, (v_raised * t.pct) / 100);
end $$;

create function public.submit_pool_tranche_evidence(p_tranche uuid, p_user uuid, p_notes text, p_links text[], p_now timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; t public.pool_tranches; v_status public.pool_status; v_id uuid;
begin
  perform public.l2_assert_enabled();
  select pool_id into v_pool from public.pool_tranches where id = p_tranche;
  if not found or public.l2_owner(v_pool) <> p_user then perform public.l2_fail('tranche_not_found', 'We couldn''t find that milestone.'); end if;
  select status into v_status from public.pools where id = v_pool for update;
  select * into t from public.pool_tranches where id = p_tranche for update;
  if v_status not in ('funded', 'matured') or t.seq = 1 or t.status not in ('pending', 'evidence_submitted') then
    perform public.l2_fail('evidence_not_accepted', 'Evidence can be added to a later milestone of a funded Pool before it is verified.');
  end if;
  insert into public.pool_tranche_evidence (tranche_id, submitted_by, notes, links, created_at) values (p_tranche, p_user, p_notes, coalesce(p_links, '{}'), p_now) returning id into v_id;
  update public.pool_tranches set status = 'evidence_submitted' where id = p_tranche;
  insert into public.audit_events (actor_id, action, entity, entity_id, data) values (p_user, 'pool_tranche.evidence_submitted', 'pool_tranche', p_tranche, jsonb_build_object('evidence_id', v_id));
  return v_id;
end $$;

-- Verify a milestone. Its disburse op is queued only when every earlier tranche is released (else
-- record_pool_tranche_released queues it when the previous one is released) — never a stale amount (design §5).
create function public.verify_pool_tranche(p_tranche uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; t public.pool_tranches; v_status public.pool_status;
begin
  perform public.l2_assert_enabled();
  select pool_id into v_pool from public.pool_tranches where id = p_tranche;
  if not found then perform public.l2_fail('tranche_not_found', 'No such milestone.'); end if;
  if public.l2_owner(v_pool) = p_reviewer then perform public.l2_fail('reviewer_is_owner', 'You can''t verify a Pool you own.'); end if;
  select status into v_status from public.pools where id = v_pool for update;
  select * into t from public.pool_tranches where id = p_tranche for update;
  if v_status not in ('funded', 'matured') then perform public.l2_fail('pool_not_funded', 'Only a funded Pool''s milestones can be verified.'); end if;
  if t.status <> 'evidence_submitted' then perform public.l2_fail('evidence_required', 'This milestone has no evidence waiting for verification.'); end if;
  update public.pool_tranches set status = 'verified', verified_by = p_reviewer, verified_at = p_now where id = p_tranche;
  if not exists (select 1 from public.pool_tranches where pool_id = v_pool and seq < t.seq and status <> 'released') then
    perform public.l2_queue_op('disburse', p_tranche, v_pool, public.pool_tranche_release_amount(p_tranche), p_now);
  end if;
  insert into public.audit_events (actor_id, action, entity, entity_id) values (p_reviewer, 'pool_tranche.verified', 'pool_tranche', p_tranche);
end $$;

create function public.record_pool_tranche_released(p_tranche uuid, p_ref text, p_amount bigint, p_idem text, p_now timestamptz) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; t public.pool_tranches; nx public.pool_tranches; v_amt bigint;
begin
  select pool_id into v_pool from public.pool_tranches where id = p_tranche;
  if not found then perform public.l2_fail('tranche_not_found', 'No such milestone.'); end if;
  perform 1 from public.pools where id = v_pool and status in ('funded', 'matured') for update;
  if not found then perform public.l2_fail('pool_not_funded', 'Only a funded Pool can release money.'); end if;
  select * into t from public.pool_tranches where id = p_tranche for update;
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return t.released_minor; end if;
  if t.status <> 'verified' then perform public.l2_fail('tranche_state', format('Milestone is %s, expected verified.', t.status)); end if;
  if exists (select 1 from public.pool_tranches where pool_id = v_pool and seq < t.seq and status <> 'released') then
    perform public.l2_fail('earlier_tranche_pending', 'Earlier milestones must be released first.');
  end if;
  v_amt := public.pool_tranche_release_amount(t.id);
  if v_amt is distinct from p_amount then
    perform public.l2_fail('payout_amount_mismatch', format('The provider disbursed %s; %s is owed.', public.l2_usd(p_amount), public.l2_usd(v_amt)));
  end if;
  perform public.ledger_post_pool('pool_tranche.released', p_idem, v_pool, jsonb_build_array(
    jsonb_build_object('kind', 'pool_issuer_payable', 'amount', v_amt),
    jsonb_build_object('kind', 'pool_escrow', 'amount', -v_amt)
  ), null, p_ref, 'tranche ' || t.seq);
  update public.pool_tranches set status = 'released', released_minor = v_amt, released_at = p_now where id = t.id;
  -- The next tranche, if already verified, gets its disburse op now (with the amount owed after this release).
  select * into nx from public.pool_tranches where pool_id = v_pool and seq = t.seq + 1 for update;
  if found and nx.status = 'verified' then
    perform public.l2_queue_op('disburse', nx.id, v_pool, public.pool_tranche_release_amount(nx.id), p_now);
  end if;
  insert into public.audit_events (action, entity, entity_id, data) values ('pool_tranche.released', 'pool_tranche', t.id, jsonb_build_object('amount_minor', v_amt, 'ref', p_ref));
  return v_amt;
end $$;
