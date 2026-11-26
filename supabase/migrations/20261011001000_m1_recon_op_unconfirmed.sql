-- M1 follow-up (found in the PR #12 Layer 2 review, round 3): an `outbound_ops` row in `sent` is in flight for
-- `recon.inflightGraceMinutes` only. After that, reconciliation looks the movement up at the provider (`findRefund` /
-- `findTransfer`): confirmed there → recorded through the webhook's SQL path; not found → an `op_unconfirmed` break
-- (run-derived, non-pausing). Design 02 §7. This migration only admits the new break kind.

alter table public.recon_breaks drop constraint recon_breaks_kind_check;
alter table public.recon_breaks add constraint recon_breaks_kind_check check (kind in (
  'campaign_diff', 'unmatched_provider_txn', 'unmatched_ledger_txn', 'amount_mismatch', 'currency_mismatch',
  'liability_mismatch', 'stray_capture_aged', 'counter_mismatch', 'waiting_funds', 'op_unconfirmed'));
