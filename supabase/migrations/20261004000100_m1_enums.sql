-- M1 · enum values. Own file: a new enum value can't be used in the transaction that adds it.
-- refund_pending: a refund has been requested for this backing and is waiting for the provider's confirmation
-- (late captures, staff refunds). Design 02 §3.5.
alter type public.backing_status add value if not exists 'refund_pending';
