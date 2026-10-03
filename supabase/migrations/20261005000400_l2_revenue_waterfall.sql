-- Layer 2 (CR-002) · royalty ingestion (01b §3), collected-only reconciliation (AC-R1…R4, R8), default handling
-- (01b §5) and the Waterfall commit (01a §4; AC-W2…W4, W6). Design §6–§7.

create table public.revenue_sources (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  revenue_type public.revenue_type not null,
  kind text not null check (kind in ('distributor', 'split_payee', 'lockbox', 'letter_of_direction', 'self_report')),
  name text not null,
  status text not null default 'ACTIVE' check (status in ('PENDING', 'ACTIVE', 'STALE', 'REVOKED', 'ERROR')),
  created_at timestamptz not null default now(),
  unique (pool_id, revenue_type)
);

-- A distributor statement for one period (verification API_VERIFIED in the mock; SELF_REPORTED for trust-based Pools).
create table public.revenue_statements (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  period_label text not null check (char_length(period_label) between 2 and 40),
  period_start date not null,
  period_end date not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  gross_minor bigint not null check (gross_minor >= 0),
  covered_minor bigint not null check (covered_minor >= 0),
  verification text not null check (verification in ('API_VERIFIED', 'SELF_REPORTED')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references public.profiles (id),
  status text not null default 'reported' check (status in ('reported', 'short', 'collected')),
  collected_minor bigint not null default 0 check (collected_minor >= 0),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pool_id, period_label),
  check (period_end > period_start),
  check (collected_minor <= covered_minor)
);

-- Cash that actually arrived in the Pool's collection account (from the provider's deposit webhook): BANK_RECONCILED.
create table public.settlement_lines (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  provider_ref text not null unique,
  amount_minor bigint not null check (amount_minor > 0),
  reference text,
  verification text not null default 'BANK_RECONCILED' check (verification = 'BANK_RECONCILED'),
  settled_at timestamptz not null,
  statement_id uuid references public.revenue_statements (id),
  matched_at timestamptz,
  created_at timestamptz not null default now()
);
create index settlement_lines_unmatched_idx on public.settlement_lines (pool_id, reference) where statement_id is null;

create table public.revenue_recon_runs (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  as_of timestamptz not null,
  summary jsonb not null,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now()
);

create table public.pool_breaks (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  kind text not null check (kind in ('revenue_shortfall', 'revenue_overage', 'unapplied_funding', 'escrow_diff', 'collection_diff')),
  dedupe_key text not null,
  amount_minor bigint not null default 0,
  refs jsonb not null default '{}',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create unique index pool_breaks_open_key on public.pool_breaks (dedupe_key) where resolved_at is null;

-- ── Cash in (deposit webhook) ──────────────────────────────────────────
create function public.record_collection_deposit(p_pool uuid, p_ref text, p_amount bigint, p_reference text, p_settled_at timestamptz, p_idem text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  perform 1 from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No Pool for this collection account.'); end if;
  insert into public.settlement_lines (pool_id, provider_ref, amount_minor, reference, settled_at)
  values (p_pool, p_ref, p_amount, p_reference, p_settled_at);
  perform public.ledger_post_pool('revenue.deposit', p_idem, p_pool, jsonb_build_array(
    jsonb_build_object('kind', 'pool_collection', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_revenue_suspense', 'amount', -p_amount)
  ), null, p_ref, p_reference);
  insert into public.audit_events (action, entity, entity_id, data) values ('revenue.deposit', 'pool', p_pool, jsonb_build_object('amount_minor', p_amount, 'reference', p_reference));
  return 'applied';
end $$;

-- ── Default state (01b §5) ─────────────────────────────────────────────
-- Is any royalty period past due without its cash? Periods are consecutive windows from close (policy period_months).
create function public.l2_past_due(p_pool uuid, p_now timestamptz) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare p public.pools; v_months int := (public.l2_policy('period_months') #>> '{}')::int; v_due int := (public.l2_policy('settlement_due_days') #>> '{}')::int;
        v_periods int := 0; v_collected int;
begin
  select * into p from public.pools where id = p_pool;
  if p.closed_at is null then return false; end if;
  while p.closed_at + make_interval(months => v_months * (v_periods + 1)) + make_interval(days => v_due) <= p_now and v_periods < 240 loop
    v_periods := v_periods + 1;
  end loop;
  select count(*) into v_collected from public.revenue_statements where pool_id = p_pool and status = 'collected';
  return v_periods > v_collected
      or exists (select 1 from public.revenue_statements where pool_id = p_pool and status <> 'collected'
                   and period_end + v_due < p_now::date);
end $$;

create function public.l2_set_state(p_pool uuid, p_to public.collection_state, p_now timestamptz, p_actor uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from public.collection_state;
begin
  select collection_state into v_from from public.pools where id = p_pool;
  if v_from = p_to then return; end if;
  update public.pools set collection_state = p_to, collection_state_since = p_now where id = p_pool;
  insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'collection_state', 'pool_id', p_pool, 'from', v_from, 'to', p_to, 'at', p_now));
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_actor, 'pool.collection_state', 'pool', p_pool, jsonb_build_object('from', v_from, 'to', p_to, 'reason', p_reason));
end $$;

-- ── Reconciliation: only bank-reconciled cash becomes collected (AC-R1, R2); idempotent (R8) ──
create function public.reconcile_pool_revenue(p_pool uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.pools; s record; v_new bigint; v_total bigint; v_collect bigint; v_out jsonb := '[]'; v_risk boolean; v_cure int;
begin
  perform public.l2_assert_enabled();
  select * into p from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No such Pool.'); end if;
  for s in select * from public.revenue_statements where pool_id = p.id and status in ('reported', 'short') order by period_start for update loop
    select coalesce(sum(amount_minor), 0) into v_new from public.settlement_lines where pool_id = p.id and reference = s.period_label and statement_id is null;
    if v_new > 0 then
      update public.settlement_lines set statement_id = s.id, matched_at = p_now where pool_id = p.id and reference = s.period_label and statement_id is null;
    end if;
    select coalesce(sum(amount_minor), 0) into v_total from public.settlement_lines where statement_id = s.id;
    v_collect := least(v_total, s.covered_minor) - s.collected_minor;
    if v_collect > 0 then
      perform public.ledger_post_pool('revenue.collected', 'revenue.collected:' || s.id || ':' || (s.collected_minor + v_collect), p.id, jsonb_build_array(
        jsonb_build_object('kind', 'pool_revenue_suspense', 'amount', v_collect),
        jsonb_build_object('kind', 'pool_revenue_unallocated', 'amount', -v_collect)
      ), null, null, s.period_label);
    end if;
    update public.revenue_statements
       set collected_minor = collected_minor + greatest(v_collect, 0),
           status = case when v_total >= covered_minor then 'collected' when v_total > 0 then 'short' else 'reported' end,
           reconciled_at = case when v_total > 0 then p_now else reconciled_at end
     where id = s.id;
    if v_total > 0 and v_total < s.covered_minor then
      insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs)
      values (p.id, 'revenue_shortfall', 'shortfall:' || s.id, s.covered_minor - v_total, jsonb_build_object('statement_id', s.id, 'period', s.period_label))
      on conflict (dedupe_key) where resolved_at is null do update set amount_minor = excluded.amount_minor;
    elsif v_total >= s.covered_minor then
      update public.pool_breaks set resolved_at = p_now, resolution = 'collected' where dedupe_key = 'shortfall:' || s.id and resolved_at is null;
    end if;
    if v_total > s.covered_minor then
      insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs)
      values (p.id, 'revenue_overage', 'overage:' || s.id, v_total - s.covered_minor, jsonb_build_object('statement_id', s.id, 'period', s.period_label))
      on conflict (dedupe_key) where resolved_at is null do update set amount_minor = excluded.amount_minor;
    end if;
    v_out := v_out || jsonb_build_object('statement_id', s.id, 'period', s.period_label, 'covered_minor', s.covered_minor, 'cash_minor', v_total,
                                         'collected_now_minor', greatest(v_collect, 0));
  end loop;

  -- Collection state (01b §5).
  if p.status = 'funded' then
    v_risk := public.l2_past_due(p.id, p_now);
    v_cure := (public.l2_policy('cure_days') #>> '{}')::int;
    if p.collection_state = 'COLLECTING' and v_risk then
      perform public.l2_set_state(p.id, 'AT_RISK', p_now, null, 'period past due without full collection');
    elsif p.collection_state = 'AT_RISK' and not v_risk then
      perform public.l2_set_state(p.id, 'COLLECTING', p_now, null, 'cured');
    elsif p.collection_state = 'AT_RISK' and v_risk and p.collection_state_since + make_interval(days => v_cure) <= p_now then
      perform public.l2_set_state(p.id, 'DEFAULT', p_now, null, 'not cured within the cure period');
    elsif p.collection_state = 'REMEDIATION' and not v_risk then
      perform public.l2_set_state(p.id, 'COLLECTING', p_now, null, 'remediated');
    end if;
  end if;

  insert into public.revenue_recon_runs (pool_id, as_of, summary)
  values (p.id, p_now, jsonb_build_object('statements', v_out, 'unallocated_minor', -public.pool_balance('pool_revenue_unallocated', p.id),
                                          'suspense_minor', -public.pool_balance('pool_revenue_suspense', p.id),
                                          'collection_state', (select collection_state from public.pools where id = p.id)));
  return jsonb_build_object('statements', v_out, 'unallocated_minor', -public.pool_balance('pool_revenue_unallocated', p.id),
                            'collection_state', (select collection_state from public.pools where id = p.id));
end $$;

-- Staff transitions out of DEFAULT (01b §5).
create function public.set_collection_state(p_pool uuid, p_staff uuid, p_to public.collection_state, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from public.collection_state;
begin
  perform public.l2_assert_enabled();
  if public.l2_owner(p_pool) = p_staff then perform public.l2_fail('reviewer_is_owner', 'You can''t act on a Pool you own.'); end if;
  select collection_state into v_from from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No such Pool.'); end if;
  if not ((v_from = 'DEFAULT' and p_to in ('REMEDIATION', 'CHARGED_OFF')) or (v_from = 'REMEDIATION' and p_to in ('CHARGED_OFF', 'COLLECTING'))) then
    perform public.l2_fail('illegal_collection_transition', format('A Pool can''t move from %s to %s.', v_from, p_to));
  end if;
  perform public.l2_set_state(p_pool, p_to, now(), p_staff, p_reason);
end $$;

-- ── Waterfall (01a §4) ─────────────────────────────────────────────────
create table public.distribution_runs (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete restrict,
  label text not null check (char_length(label) between 2 and 40),
  run_total_minor bigint not null check (run_total_minor > 0),
  fans_minor bigint not null,
  creator_minor bigint not null,
  platform_minor bigint not null,
  cap_overflow_minor bigint not null default 0,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  allocation jsonb not null,
  status text not null default 'committed' check (status in ('committed', 'paid')),
  committed_by uuid references public.profiles (id),
  committed_at timestamptz not null default now(),
  correlation_id text default public.ctx('correlation_id'),
  unique (pool_id, label)
);
create table public.distribution_payouts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.distribution_runs (id),
  pool_id uuid not null references public.pools (id),
  kind text not null check (kind in ('investor', 'creator', 'platform')),
  investment_id uuid references public.investments (id),
  investor_id uuid references public.profiles (id),
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  provider_ref text,
  -- Mechanism 04 default: C-corp-taxed issuer → dividends on 1099-DIV. Counsel item L2-Q6; recorded per payout so a
  -- different characterization later doesn't rewrite history.
  tax_characterization text check (tax_characterization is null or tax_characterization in ('dividend')),
  tax_form text check (tax_form is null or tax_form in ('1099-DIV')),
  paid_at timestamptz,
  check ((kind = 'investor') = (investment_id is not null))
);
create unique index distribution_payouts_unique on public.distribution_payouts (run_id, kind, coalesce(investment_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index distribution_payouts_investor_idx on public.distribution_payouts (investor_id);

-- Data rows for year-end tax reporting (no forms are produced in the demo).
create table public.tax_1099_rows (
  tax_year integer not null,
  investor_id uuid not null references public.profiles (id),
  pool_id uuid not null references public.pools (id),
  form text not null check (form in ('1099-DIV')),
  box text not null,
  amount_minor bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tax_year, investor_id, pool_id, form, box)
);

-- Commit an allocation computed by packages/shared allocateWaterfall (same inputs → same hash). SQL re-verifies
-- collected-only (W3), conservation (W4), cap (W2) and the split; unique (Pool, label) makes it idempotent (W6).
create function public.commit_distribution_run(p_pool uuid, p_label text, p_hash text, p_alloc jsonb, p_actor uuid, p_now timestamptz default now())
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.pools; r public.distribution_runs; v_total bigint; v_unalloc bigint; v_fans bigint; v_creator bigint; v_platform bigint;
        v_run uuid; x jsonb; i public.investments; v_amt bigint;
begin
  perform public.l2_assert_enabled();
  select * into p from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No such Pool.'); end if;
  select * into r from public.distribution_runs where pool_id = p.id and label = p_label;
  if found then
    if r.input_hash = p_hash then return r.id; end if;
    perform public.l2_fail('run_conflict', 'A different distribution with this label was already committed.');
  end if;
  if p.status <> 'funded' then perform public.l2_fail('pool_not_distributing', format('This Pool is %s.', p.status)); end if;
  v_total := (p_alloc ->> 'runTotalMinor')::bigint;
  v_unalloc := -public.pool_balance('pool_revenue_unallocated', p.id);
  if v_unalloc <= 0 then perform public.l2_fail('nothing_to_distribute', 'There''s no collected revenue to distribute.'); end if;
  if v_total is distinct from v_unalloc then
    perform public.l2_fail('run_stale', format('Collected revenue changed (%s now, run was for %s). Run the dry-run again.', v_unalloc, v_total));
  end if;
  v_creator := (p_alloc ->> 'creatorMinor')::bigint;
  v_platform := (p_alloc ->> 'platformMinor')::bigint;
  select coalesce(sum((y ->> 'amountMinor')::bigint), 0) into v_fans from jsonb_array_elements(p_alloc -> 'payouts') y;
  if v_fans + v_creator + v_platform <> v_total or v_creator < 0 or v_platform < 0 then
    perform public.l2_fail('run_not_conserved', 'The allocation doesn''t add up to the collected amount.');
  end if;
  if v_platform <> (v_total * p.platform_bps) / 10000 or v_fans > (v_total * p.fans_bps) / 10000 then
    perform public.l2_fail('run_split_mismatch', 'The allocation doesn''t follow the Pool''s split.');
  end if;
  insert into public.distribution_runs (pool_id, label, run_total_minor, fans_minor, creator_minor, platform_minor, cap_overflow_minor, input_hash, allocation, committed_by, committed_at)
  values (p.id, p_label, v_total, v_fans, v_creator, v_platform, coalesce((p_alloc ->> 'capOverflowMinor')::bigint, 0), p_hash, p_alloc, p_actor, p_now)
  returning id into v_run;
  for x in select * from jsonb_array_elements(p_alloc -> 'payouts') loop
    v_amt := (x ->> 'amountMinor')::bigint;
    select * into i from public.investments where id = (x ->> 'investmentId')::uuid for update;
    if not found or i.pool_id <> p.id or i.status <> 'issued' then perform public.l2_fail('run_bad_holding', 'The allocation names a holding that isn''t in this Pool.'); end if;
    if v_amt <= 0 or i.distributed_minor + v_amt > i.cap_minor then perform public.l2_fail('run_over_cap', 'The allocation pays a holding past its cap.'); end if;
    update public.investments set distributed_minor = distributed_minor + v_amt where id = i.id;
    insert into public.distribution_payouts (run_id, pool_id, kind, investment_id, investor_id, amount_minor, tax_characterization, tax_form)
    values (v_run, p.id, 'investor', i.id, i.investor_id, v_amt, 'dividend', '1099-DIV');
  end loop;
  if v_creator > 0 then insert into public.distribution_payouts (run_id, pool_id, kind, amount_minor) values (v_run, p.id, 'creator', v_creator); end if;
  if v_platform > 0 then insert into public.distribution_payouts (run_id, pool_id, kind, amount_minor) values (v_run, p.id, 'platform', v_platform); end if;
  perform public.ledger_post_pool('distribution.committed', 'distribution:' || v_run, p.id, jsonb_build_array(
    jsonb_build_object('kind', 'pool_revenue_unallocated', 'amount', v_total),
    jsonb_build_object('kind', 'pool_distributions_payable', 'amount', -v_fans),
    jsonb_build_object('kind', 'pool_creator_payable', 'amount', -v_creator),
    jsonb_build_object('kind', 'pool_platform_payable', 'amount', -v_platform)
  ), null, null, p_label);
  insert into public.pool_ops (kind, subject_id, pool_id, amount_minor, idempotency_key)
  select 'payout', d.id, p.id, d.amount_minor, 'payout:' || d.id from public.distribution_payouts d where d.run_id = v_run;
  -- The Pool ends at its cap or at maturity, whichever comes first (FR-L2-WF-001).
  if not exists (select 1 from public.investments where pool_id = p.id and status = 'issued' and distributed_minor < cap_minor) then
    update public.pools set status = 'matured', matured_at = p_now, matured_reason = 'cap_reached' where id = p.id;
  elsif p.matures_at is not null and p_now >= p.matures_at then
    update public.pools set status = 'matured', matured_at = p_now, matured_reason = 'maturity' where id = p.id;
  end if;
  insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'distribution_committed', 'run_id', v_run));
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_actor, 'distribution.committed', 'distribution_run', v_run, jsonb_build_object('pool_id', p.id, 'label', p_label, 'total_minor', v_total, 'hash', p_hash));
  return v_run;
end $$;

create function public.record_pool_payout_confirmed(p_payout uuid, p_ref text, p_amount bigint, p_idem text) returns text
language plpgsql security definer set search_path = '' as $$
declare d public.distribution_payouts; v_kind public.ledger_account_kind;
begin
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  select * into d from public.distribution_payouts where id = p_payout for update;
  if not found then perform public.l2_fail('payout_not_found', 'No such payout.'); end if;
  if d.status = 'paid' then return 'duplicate'; end if;
  if d.amount_minor <> p_amount then perform public.l2_fail('payout_amount_mismatch', format('Provider paid %s, owed %s.', p_amount, d.amount_minor)); end if;
  v_kind := case d.kind when 'investor' then 'pool_distributions_payable' when 'creator' then 'pool_creator_payable' else 'pool_platform_payable' end;
  perform public.ledger_post_pool('distribution.paid', p_idem, d.pool_id, jsonb_build_array(
    jsonb_build_object('kind', v_kind, 'amount', p_amount),
    jsonb_build_object('kind', 'pool_collection', 'amount', -p_amount)
  ), d.investment_id, p_ref, d.kind);
  update public.distribution_payouts set status = 'paid', provider_ref = p_ref, paid_at = now() where id = d.id;
  if d.kind = 'investor' then
    insert into public.tax_1099_rows (tax_year, investor_id, pool_id, form, box, amount_minor)
    values (extract(year from now() at time zone 'UTC')::int, d.investor_id, d.pool_id, '1099-DIV', '1a', p_amount)
    on conflict (tax_year, investor_id, pool_id, form, box) do update set amount_minor = public.tax_1099_rows.amount_minor + excluded.amount_minor, updated_at = now();
    insert into public.outbox (topic, payload) values ('l2.notify', jsonb_build_object('template', 'distribution_paid', 'payout_id', d.id));
  end if;
  if not exists (select 1 from public.distribution_payouts where run_id = d.run_id and status <> 'paid') then
    update public.distribution_runs set status = 'paid' where id = d.run_id;
  end if;
  return 'applied';
end $$;
