-- Layer 2 (CR-002) · royalty ingestion (01b §3), collected-only reconciliation (AC-R1…R4, R8), default handling
-- (01b §5), maturity, and the Waterfall commit (01a §4; AC-W2…W4, W6). Design §6–§7.
-- Same rules as 0300: one clock (p_now), lock-then-check, flag only on entry paths (commit_distribution_run here);
-- reconciliation, maturity, collection-state moves by staff and payout confirmations run with the flag off.

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

-- A royalty statement for one expected period window (design §6). Creator uploads are always SELF_REPORTED, whatever
-- the collection mechanism (PR #10 review round 2, finding 9). API_VERIFIED stays in the check for a future
-- distributor-API feed the demo doesn't build; no demo path (seed included) writes it.
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
  unique (pool_id, period_start),
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

-- Layer 2 breaks, never recon_breaks (gate condition 1). Pausing kinds and auto-resolution: design §5.1.
create table public.pool_breaks (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  kind text not null check (kind in (
    'revenue_shortfall', 'revenue_overage', 'unapplied_funding', 'escrow_diff', 'collection_diff',
    'counter_mismatch', 'liability_mismatch', 'amount_mismatch', 'stray_fund_move_aged',
    'unmatched_provider_txn', 'unmatched_ledger_txn', 'refund_overdue')),
  dedupe_key text not null,
  amount_minor bigint not null default 0,
  refs jsonb not null default '{}',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create unique index pool_breaks_open_key on public.pool_breaks (dedupe_key) where resolved_at is null;

-- ── Expected royalty periods (design §6): consecutive windows from close, stopping at maturity ──
-- Window k starts at close + k·period_months; the last ends at matures_at; none starts after it. Dates are UTC days,
-- period_end inclusive. A statement must name exactly one window; a period is due settlement_due_days after it ends.
create function public.l2_period_windows(p_pool uuid)
returns table (seq integer, period_start date, period_end date, ends_at timestamptz, due_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare p public.pools; v_months int := (public.l2_policy('period_months') #>> '{}')::int;
        v_due int := (public.l2_policy('settlement_due_days') #>> '{}')::int; k int := 0; s timestamptz; e timestamptz;
begin
  select * into p from public.pools where id = p_pool;
  if p.closed_at is null or p.matures_at is null then return; end if;
  loop
    s := p.closed_at + make_interval(months => v_months * k);
    exit when s >= p.matures_at or k >= 480;
    e := least(p.closed_at + make_interval(months => v_months * (k + 1)), p.matures_at);
    return query select k + 1, (s at time zone 'UTC')::date, (e at time zone 'UTC')::date - 1, e, e + make_interval(days => v_due);
    k := k + 1;
  end loop;
end $$;

-- Statements tie to expected windows and stop at maturity; only a funded or matured Pool takes them.
create function public.l2_statement_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status public.pool_status; v_matures date;
begin
  select status, (matures_at at time zone 'UTC')::date into v_status, v_matures from public.pools where id = new.pool_id;
  if v_status not in ('funded', 'matured') then
    perform public.l2_fail('pool_not_funded', 'Statements can be added once the Pool has closed funded.');
  end if;
  if new.period_end >= v_matures then
    perform public.l2_fail('pool_matured', 'This Pool has matured; there are no royalty periods after its maturity date.');
  end if;
  if not exists (select 1 from public.l2_period_windows(new.pool_id) w where w.period_start = new.period_start and w.period_end = new.period_end) then
    perform public.l2_fail('period_not_expected', 'Statements cover one royalty period of the Pool''s schedule. Pick a period from the list.');
  end if;
  return new;
end $$;
create trigger revenue_statements_window before insert or update of period_start, period_end, pool_id on public.revenue_statements
  for each row execute function public.l2_statement_guard();

-- ── Cash in (deposit webhook) ──────────────────────────────────────────
create function public.record_collection_deposit(p_pool uuid, p_ref text, p_amount bigint, p_reference text, p_settled_at timestamptz, p_idem text, p_now timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No Pool for this collection account.'); end if;
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) then return 'duplicate'; end if;
  insert into public.settlement_lines (pool_id, provider_ref, amount_minor, reference, settled_at, created_at)
  values (p_pool, p_ref, p_amount, p_reference, p_settled_at, p_now);
  perform public.ledger_post_pool('revenue.deposit', p_idem, p_pool, jsonb_build_array(
    jsonb_build_object('kind', 'pool_collection', 'amount', p_amount),
    jsonb_build_object('kind', 'pool_revenue_suspense', 'amount', -p_amount)
  ), null, p_ref, p_reference);
  insert into public.audit_events (action, entity, entity_id, data) values ('revenue.deposit', 'pool', p_pool, jsonb_build_object('amount_minor', p_amount, 'reference', p_reference));
  return 'applied';
end $$;

-- ── Default state (01b §5) ─────────────────────────────────────────────
-- Is any expected window (ending on or before maturity) past its due date without a statement that is collected — bank-
-- reconciled cash > 0 covering it (a zero-cash statement never counts)?
create function public.l2_past_due(p_pool uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.l2_period_windows(p_pool) w
     where w.due_at <= p_now
       and not exists (select 1 from public.revenue_statements s
                        where s.pool_id = p_pool and s.status = 'collected' and s.collected_minor > 0
                          and s.period_start = w.period_start and s.period_end = w.period_end))
$$;

create function public.l2_set_state(p_pool uuid, p_to public.collection_state, p_now timestamptz, p_actor uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from public.collection_state;
begin
  select collection_state into v_from from public.pools where id = p_pool;
  if v_from = p_to then return; end if;
  update public.pools set collection_state = p_to, collection_state_since = p_now where id = p_pool;
  perform public.l2_notify('collection_state', jsonb_build_object('pool_id', p_pool, 'from', v_from, 'to', p_to, 'at', p_now));
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_actor, 'pool.collection_state', 'pool', p_pool, jsonb_build_object('from', v_from, 'to', p_to, 'reason', p_reason));
end $$;

-- ── Reconciliation: only bank-reconciled cash becomes collected (AC-R1, R2); idempotent (R8) ──
-- A completion path: runs with the flag off. Short statements are re-reconciled every run and each run collects only
-- the increment (the ledger key carries the cumulative collected amount); the shortfall break resolves once collected.
-- Collection state for funded and matured Pools: COLLECTING → AT_RISK → DEFAULT (adverse moves only while the flag is
-- on), AT_RISK → COLLECTING when cured. DEFAULT / REMEDIATION / CHARGED_OFF move only by staff (set_collection_state).
create function public.reconcile_pool_revenue(p_pool uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.pools; s record; v_new bigint; v_total bigint; v_collect bigint; v_out jsonb := '[]'; v_risk boolean; v_cure int; v_on boolean;
begin
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
           status = case when v_total > 0 and v_total >= covered_minor then 'collected' when v_total > 0 then 'short' else 'reported' end,
           reconciled_at = case when v_total > 0 then p_now else reconciled_at end
     where id = s.id;
    if v_total > 0 and v_total < s.covered_minor then
      insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs, opened_at)
      values (p.id, 'revenue_shortfall', 'shortfall:' || s.id, s.covered_minor - v_total, jsonb_build_object('statement_id', s.id, 'period', s.period_label), p_now)
      on conflict (dedupe_key) where resolved_at is null do update set amount_minor = excluded.amount_minor;
    elsif v_total > 0 and v_total >= s.covered_minor then
      update public.pool_breaks set resolved_at = p_now, resolution = 'collected' where dedupe_key = 'shortfall:' || s.id and resolved_at is null;
    end if;
    if v_total > s.covered_minor then
      insert into public.pool_breaks (pool_id, kind, dedupe_key, amount_minor, refs, opened_at)
      values (p.id, 'revenue_overage', 'overage:' || s.id, v_total - s.covered_minor, jsonb_build_object('statement_id', s.id, 'period', s.period_label), p_now)
      on conflict (dedupe_key) where resolved_at is null do update set amount_minor = excluded.amount_minor;
    end if;
    v_out := v_out || jsonb_build_object('statement_id', s.id, 'period', s.period_label, 'covered_minor', s.covered_minor, 'cash_minor', v_total,
                                         'collected_now_minor', greatest(v_collect, 0));
  end loop;

  -- Collection state (01b §5).
  if p.status in ('funded', 'matured') then
    v_risk := public.l2_past_due(p.id, p_now);
    v_cure := (public.l2_policy('cure_days') #>> '{}')::int;
    v_on := public.l2_enabled();
    if p.collection_state = 'COLLECTING' and v_risk and v_on then
      perform public.l2_set_state(p.id, 'AT_RISK', p_now, null, 'period past due without full collection');
    elsif p.collection_state = 'AT_RISK' and not v_risk then
      perform public.l2_set_state(p.id, 'COLLECTING', p_now, null, 'cured');
    elsif p.collection_state = 'AT_RISK' and v_risk and v_on and p.collection_state_since + make_interval(days => v_cure) <= p_now then
      perform public.l2_set_state(p.id, 'DEFAULT', p_now, null, 'not cured within the cure period');
    end if;
  end if;

  insert into public.revenue_recon_runs (pool_id, as_of, summary, created_at)
  values (p.id, p_now, jsonb_build_object('statements', v_out, 'unallocated_minor', -public.pool_balance('pool_revenue_unallocated', p.id),
                                          'suspense_minor', -public.pool_balance('pool_revenue_suspense', p.id),
                                          'collection_state', (select collection_state from public.pools where id = p.id)), p_now);
  return jsonb_build_object('statements', v_out, 'unallocated_minor', -public.pool_balance('pool_revenue_unallocated', p.id),
                            'collection_state', (select collection_state from public.pools where id = p.id));
end $$;

-- Staff collection-state moves (01b §5): DEFAULT → REMEDIATION | CHARGED_OFF, REMEDIATION → CHARGED_OFF, and
-- REMEDIATION → COLLECTING only once cured (no period past due at p_now), else `not_cured`. Runs with the flag off.
create function public.set_collection_state(p_pool uuid, p_staff uuid, p_to public.collection_state, p_reason text, p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from public.collection_state;
begin
  if public.l2_owner(p_pool) = p_staff then perform public.l2_fail('reviewer_is_owner', 'You can''t act on a Pool you own.'); end if;
  select collection_state into v_from from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No such Pool.'); end if;
  if not ((v_from = 'DEFAULT' and p_to in ('REMEDIATION', 'CHARGED_OFF')) or (v_from = 'REMEDIATION' and p_to in ('CHARGED_OFF', 'COLLECTING'))) then
    perform public.l2_fail('illegal_collection_transition', format('A Pool can''t move from %s to %s.', v_from, p_to));
  end if;
  if v_from = 'REMEDIATION' and p_to = 'COLLECTING' and public.l2_past_due(p_pool, p_now) then
    perform public.l2_fail('not_cured', 'A royalty period is still past due without collected cash.');
  end if;
  perform public.l2_set_state(p_pool, p_to, p_now, p_staff, p_reason);
end $$;

-- Maturity by date (design §7): funded → matured ('maturity') once p_now ≥ matures_at, under the pool lock, whether or
-- not a run was committed. A completion path (runs with the flag off). Returns how many Pools matured.
create function public.mature_due_pools(p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.pools where status = 'funded' and matures_at <= p_now order by id loop
    update public.pools set status = 'matured', matured_at = p_now, matured_reason = 'maturity'
     where id = r.id and status = 'funded' and matures_at <= p_now;
    if found then
      perform public.l2_notify('pool_matured', jsonb_build_object('pool_id', r.id, 'reason', 'maturity'), 'pool_matured:' || r.id);
      insert into public.audit_events (action, entity, entity_id, data) values ('pool.matured', 'pool', r.id, jsonb_build_object('reason', 'maturity'));
      n := n + 1;
    end if;
  end loop;
  return n;
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

-- Commit an allocation computed by packages/shared allocateWaterfall (same inputs → same hash). SQL re-verifies, under
-- the pool lock: collected-only (W3), conservation (W4), platform = ⌊C·platform⌋, fans ≤ ⌊C·fans⌋ and fans = ⌊C·fans⌋
-- unless every issued investment ends the run at its cap (cap overflow), each payout within its cap (W2). distributed_minor
-- grows at commit. unique (Pool, label) makes it idempotent (W6). Accepts funded or matured Pools (final runs).
create function public.commit_distribution_run(p_pool uuid, p_label text, p_hash text, p_alloc jsonb, p_actor uuid, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.pools; r public.distribution_runs; v_total bigint; v_unalloc bigint; v_fans bigint; v_creator bigint; v_platform bigint;
        v_run uuid; x jsonb; i public.investments; v_amt bigint; v_fan_share bigint;
begin
  perform public.l2_assert_enabled();
  select * into p from public.pools where id = p_pool for update;
  if not found then perform public.l2_fail('pool_not_found', 'No such Pool.'); end if;
  select * into r from public.distribution_runs where pool_id = p.id and label = p_label;
  if found then
    if r.input_hash = p_hash then return r.id; end if;
    perform public.l2_fail('run_conflict', 'A different distribution with this label was already committed.');
  end if;
  if p.status not in ('funded', 'matured') then perform public.l2_fail('pool_not_distributing', format('This Pool is %s.', p.status)); end if;
  v_total := (p_alloc ->> 'runTotalMinor')::bigint;
  v_unalloc := -public.pool_balance('pool_revenue_unallocated', p.id);
  if v_unalloc <= 0 then perform public.l2_fail('nothing_to_distribute', 'There''s no collected revenue to distribute.'); end if;
  if v_total is distinct from v_unalloc then
    perform public.l2_fail('run_stale', format('Collected revenue changed (%s now; the run was for %s). Run the dry-run again.', public.l2_usd(v_unalloc), public.l2_usd(coalesce(v_total, 0))));
  end if;
  v_creator := (p_alloc ->> 'creatorMinor')::bigint;
  v_platform := (p_alloc ->> 'platformMinor')::bigint;
  select coalesce(sum((y ->> 'amountMinor')::bigint), 0) into v_fans from jsonb_array_elements(p_alloc -> 'payouts') y;
  if v_fans + v_creator + v_platform <> v_total or v_creator < 0 or v_platform < 0 then
    perform public.l2_fail('run_not_conserved', 'The allocation doesn''t add up to the collected amount.');
  end if;
  v_fan_share := (v_total * p.fans_bps) / 10000;
  if v_platform <> (v_total * p.platform_bps) / 10000 or v_fans > v_fan_share then
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
  -- Fans equality (PR #10 review round 2, finding 4): fan cents can move to the creator only as cap overflow.
  if v_fans <> v_fan_share
     and exists (select 1 from public.investments where pool_id = p.id and status = 'issued' and distributed_minor < cap_minor) then
    perform public.l2_fail('allocation_invalid', format('Fans must receive %s while a holder is under its cap; the allocation gives them %s.',
      public.l2_usd(v_fan_share), public.l2_usd(v_fans)));
  end if;
  if v_creator > 0 then insert into public.distribution_payouts (run_id, pool_id, kind, amount_minor) values (v_run, p.id, 'creator', v_creator); end if;
  if v_platform > 0 then insert into public.distribution_payouts (run_id, pool_id, kind, amount_minor) values (v_run, p.id, 'platform', v_platform); end if;
  perform public.ledger_post_pool('distribution.committed', 'distribution:' || v_run, p.id, jsonb_build_array(
    jsonb_build_object('kind', 'pool_revenue_unallocated', 'amount', v_total),
    jsonb_build_object('kind', 'pool_distributions_payable', 'amount', -v_fans),
    jsonb_build_object('kind', 'pool_creator_payable', 'amount', -v_creator),
    jsonb_build_object('kind', 'pool_platform_payable', 'amount', -v_platform)
  ), null, null, p_label);
  insert into public.pool_ops (kind, subject_id, pool_id, amount_minor, idempotency_key, next_attempt_at, created_at)
  select 'payout', d.id, p.id, d.amount_minor, public.l2_op_key('payout', d.id), p_now, p_now from public.distribution_payouts d where d.run_id = v_run
  on conflict (idempotency_key) do nothing;
  -- A commit matures the Pool only when every issued investment is at its cap; maturity by date is mature_due_pools.
  if p.status = 'funded' and not exists (select 1 from public.investments where pool_id = p.id and status = 'issued' and distributed_minor < cap_minor) then
    update public.pools set status = 'matured', matured_at = p_now, matured_reason = 'cap_reached' where id = p.id;
  end if;
  perform public.l2_notify('distribution_committed', jsonb_build_object('run_id', v_run, 'pool_id', p.id), 'distribution_committed:' || v_run);
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_actor, 'distribution.committed', 'distribution_run', v_run, jsonb_build_object('pool_id', p.id, 'label', p_label, 'total_minor', v_total, 'hash', p_hash));
  return v_run;
end $$;

create function public.record_pool_payout_confirmed(p_payout uuid, p_ref text, p_amount bigint, p_idem text, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; d public.distribution_payouts; v_kind public.ledger_account_kind;
begin
  select pool_id into v_pool from public.distribution_payouts where id = p_payout;
  if not found then perform public.l2_fail('payout_not_found', 'No such payout.'); end if;
  perform 1 from public.pools where id = v_pool for update;
  select * into d from public.distribution_payouts where id = p_payout for update;
  if exists (select 1 from public.ledger_transactions where idempotency_key = p_idem) or d.status = 'paid' then return 'duplicate'; end if;
  if d.amount_minor is distinct from p_amount then
    perform public.l2_fail('payout_amount_mismatch', format('The provider paid %s; %s is owed.', public.l2_usd(p_amount), public.l2_usd(d.amount_minor)));
  end if;
  v_kind := case d.kind when 'investor' then 'pool_distributions_payable' when 'creator' then 'pool_creator_payable' else 'pool_platform_payable' end;
  perform public.ledger_post_pool('distribution.paid', p_idem, d.pool_id, jsonb_build_array(
    jsonb_build_object('kind', v_kind, 'amount', p_amount),
    jsonb_build_object('kind', 'pool_collection', 'amount', -p_amount)
  ), d.investment_id, p_ref, d.kind);
  update public.distribution_payouts set status = 'paid', provider_ref = p_ref, paid_at = p_now where id = d.id;
  if d.kind = 'investor' then
    insert into public.tax_1099_rows (tax_year, investor_id, pool_id, form, box, amount_minor, updated_at)
    values (extract(year from p_now at time zone 'UTC')::int, d.investor_id, d.pool_id, '1099-DIV', '1a', p_amount, p_now)
    on conflict (tax_year, investor_id, pool_id, form, box) do update set amount_minor = public.tax_1099_rows.amount_minor + excluded.amount_minor, updated_at = p_now;
    perform public.l2_notify('distribution_paid', jsonb_build_object('payout_id', d.id, 'user_id', d.investor_id, 'amount_minor', p_amount), 'distribution_paid:' || d.id);
  end if;
  if not exists (select 1 from public.distribution_payouts where run_id = d.run_id and status <> 'paid') then
    update public.distribution_runs set status = 'paid' where id = d.run_id;
  end if;
  return 'applied';
end $$;
