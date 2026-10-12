-- Layer 2 (CR-002) · RLS and privileges. Clients get nothing on any Layer 2 table, view, sequence or function — public,
-- money or PII alike; there is no public view (design §3, §12; PR #10 review round 3, finding 3). Every Layer 2 read and
-- write goes through the API (service role) with explicit owner/staff scoping. apps/api/test/l2-money.test.ts asserts it.

do $$
declare t text; f record;
begin
  foreach t in array array[
    'issuers', 'pools', 'pool_transitions', 'pool_tranches', 'pool_tranche_evidence', 'pool_documents', 'pool_reviews',
    'collection_mechanisms', 'investor_profiles', 'investments', 'pool_ops', 'l2_notice_keys', 'pool_stray_fund_moves',
    'revenue_sources', 'revenue_statements', 'settlement_lines', 'revenue_recon_runs', 'pool_breaks', 'distribution_runs',
    'distribution_payouts', 'tax_1099_rows']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;

  -- Functions: service role only (Postgres grants EXECUTE to PUBLIC, and Supabase to anon/authenticated, by default).
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'cancel_investment', 'commit_distribution_run', 'enforce_pool_transition', 'execute_collection_mechanism',
       'expire_investment_reservations', 'l2_assert_enabled', 'l2_cancel_by', 'l2_claim_pool_ops', 'l2_counted_reservation',
       'l2_enabled', 'l2_expiry_action', 'l2_expiry_candidates', 'l2_fail', 'l2_issuer_cap_remaining', 'l2_lock_owner_artists',
       'l2_maybe_mark_refunded', 'l2_notify', 'l2_notify_commitment', 'l2_op_key', 'l2_op_start_call', 'l2_owner', 'l2_past_due',
       'l2_period_windows', 'l2_policy', 'l2_pool_terms', 'l2_pool_terms_guard', 'l2_pool_terms_hash', 'l2_queue_op',
       'l2_recount_investors', 'l2_reservation_live', 'l2_risk_badge', 'l2_set_state', 'l2_statement_guard',
       'l2_tranche_terms_guard', 'l2_usd', 'launch_pool', 'ledger_post_pool', 'mark_investment_funding', 'mature_due_pools',
       'pool_account', 'pool_balance', 'pool_tranche_release_amount', 'reconcile_pool_revenue', 'record_collection_deposit',
       'record_investment_funded', 'record_investment_provider_refs', 'record_investment_refunded', 'record_investment_returned',
       'record_pool_payout_confirmed', 'record_pool_tranche_released', 'record_stray_fund_move', 'record_stray_fund_refund_confirmed',
       'regcf_investor_limit', 'regcf_usage', 'reserve_investment', 'review_pool', 'set_collection_state', 'settle_pool',
       'submit_pool', 'submit_pool_tranche_evidence', 'verify_pool_tranche')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
