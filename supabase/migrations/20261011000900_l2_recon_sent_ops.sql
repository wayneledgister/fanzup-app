-- Layer 2 (CR-002) · a `pool_ops` row in `sent` is in flight for `recon.inflightGraceMinutes` only (PR #12 review round 3,
-- finding 2; design §5.1). `sent_at` is the clock of the runner tick that recorded the provider's acceptance; after the
-- grace, recon looks the movement up at the provider: settled there → the confirmation is recorded through the same SQL
-- as the webhook; not found (or ended in another state) → an `op_unconfirmed` break (run-derived, non-pausing).

alter table public.pool_ops add column sent_at timestamptz;
comment on column public.pool_ops.sent_at is
  'When the runner recorded the provider''s acceptance (status sent), at the tick clock; recon treats the op as in flight for recon.inflightGraceMinutes after it.';
update public.pool_ops set sent_at = updated_at where status = 'sent' and sent_at is null;

alter table public.pool_breaks drop constraint pool_breaks_kind_check;
alter table public.pool_breaks add constraint pool_breaks_kind_check check (kind in (
  'revenue_shortfall', 'revenue_overage', 'unapplied_funding', 'escrow_diff', 'collection_diff',
  'counter_mismatch', 'liability_mismatch', 'amount_mismatch', 'stray_fund_move_aged',
  'unmatched_provider_txn', 'unmatched_ledger_txn', 'refund_overdue', 'op_unconfirmed'));
