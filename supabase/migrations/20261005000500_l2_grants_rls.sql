-- Layer 2 (CR-002) · RLS and privileges. Clients get nothing: every Layer 2 read and write goes through the API
-- (service role) with explicit owner/staff scoping, behind the server-side flag (design §2, §12; NFR-L2-03).

alter table public.issuers enable row level security;
alter table public.pools enable row level security;
alter table public.pool_transitions enable row level security;
alter table public.pool_tranches enable row level security;
alter table public.pool_tranche_evidence enable row level security;
alter table public.pool_documents enable row level security;
alter table public.pool_reviews enable row level security;
alter table public.collection_mechanisms enable row level security;
alter table public.investor_profiles enable row level security;
alter table public.investments enable row level security;
alter table public.pool_ops enable row level security;
alter table public.revenue_sources enable row level security;
alter table public.revenue_statements enable row level security;
alter table public.settlement_lines enable row level security;
alter table public.revenue_recon_runs enable row level security;
alter table public.pool_breaks enable row level security;
alter table public.distribution_runs enable row level security;
alter table public.distribution_payouts enable row level security;
alter table public.tax_1099_rows enable row level security;

revoke all on public.issuers, public.pools, public.pool_transitions, public.pool_tranches, public.pool_tranche_evidence,
  public.pool_documents, public.pool_reviews, public.collection_mechanisms, public.investor_profiles, public.investments,
  public.pool_ops, public.revenue_sources, public.revenue_statements, public.settlement_lines, public.revenue_recon_runs,
  public.pool_breaks, public.distribution_runs, public.distribution_payouts, public.tax_1099_rows
from anon, authenticated;

-- Functions: service role only (Supabase grants EXECUTE on new public functions to anon/authenticated by default).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'l2_fail', 'l2_enabled', 'l2_assert_enabled', 'l2_policy', 'pool_account', 'ledger_post_pool', 'pool_balance', 'l2_risk_badge',
       'enforce_pool_transition', 'l2_queue_op', 'l2_owner', 'submit_pool', 'review_pool', 'execute_collection_mechanism', 'launch_pool',
       'regcf_investor_limit', 'regcf_usage', 'reserve_investment', 'l2_recount_investors', 'mark_investment_funding',
       'record_investment_funded', 'record_investment_returned', 'expire_investment_reservations', 'cancel_investment', 'settle_pool',
       'record_investment_refunded', 'pool_tranche_release_amount', 'submit_pool_tranche_evidence', 'verify_pool_tranche',
       'record_pool_tranche_released', 'record_collection_deposit', 'l2_past_due', 'l2_set_state', 'reconcile_pool_revenue',
       'set_collection_state', 'commit_distribution_run', 'record_pool_payout_confirmed')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
