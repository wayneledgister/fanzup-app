-- PR #9 review round 2 (design §7): persist the platform float on each reconciliation run.
-- Only `platform_topup` balance transactions (Stripe `topup`, sandbox top-up: FanZuP's own float for the refund fees it
-- absorbs, §12.1) are excluded from the total diff; the run records their sum so /staff/recon/latest shows it beside the
-- totals. Every other unattributed provider movement (payout, stripe_fee, dispute, fee correction) stays in the diff.
alter table public.recon_runs add column platform_adjustments_minor bigint;
comment on column public.recon_runs.platform_adjustments_minor is
  'Σ platform_topup balance transactions at run time (the float); excluded from provider_total_minor and diff_minor.';
