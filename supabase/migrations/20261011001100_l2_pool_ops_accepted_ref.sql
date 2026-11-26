-- Layer 2 (CR-002) · PR #12 review round 4, finding 1 (design §5 Outbound). A `sent` op's `provider_ref` is the
-- provider's ACCEPTANCE ref, not proof that money moved. When staff replay a `sent` op under an open `op_unconfirmed`
-- break, that ref moves here and `provider_ref` is cleared, so a later failure of the re-call can't be mistaken for
-- "the provider moved money" (`pool_op.replay` decides that only from an `amount_mismatch` break or `last_error`). The
-- runner still looks the movement up (by the op id as externalId) before any re-call, so nothing moves twice.

alter table public.pool_ops add column accepted_ref text;
comment on column public.pool_ops.accepted_ref is
  'The provider acceptance ref of an earlier `sent` attempt that staff replayed under op_unconfirmed (kept for audit; never a confirmation).';
