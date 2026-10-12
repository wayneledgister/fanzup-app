-- PR #12 review round 5 (follow-up to merged M1 outbound code, and its Layer 2 twin; M1 design §5, L2 design §5 Outbound).
-- An outbound movement the provider reports FAILED / CANCELED / RETURNED is never re-adopted by the lookup-before-call,
-- and a retry never reuses the provider idempotency key that produced the failed object (Stripe returns the original
-- object for a reused key, so a retry under the same key can never move money again).
--
-- Model: an attempt generation per op. The key sent to the provider is `<idempotency_key>` for generation 0 and
-- `<idempotency_key>:r<gen>` after; the provider movement carries the generation in its metadata (Stripe
-- `outbound_attempt`) or in its externalId (`<op id>:r<gen>`, Reg CF). Lookups match only the current generation.
-- A movement the provider reports failed moves the op to `failed` (alert) and its ref is appended to `failed_refs`
-- (with the generation it belonged to); staff replay of an op whose CURRENT generation has a failed movement starts the
-- next generation, so the runner issues exactly one new movement under a fresh key. Any other replay (dead-letter,
-- permanent error before the call, op_unconfirmed) keeps the generation: lookup-before-call still protects against a
-- double movement on crash/retry within a generation. Ledger posting keys stay keyed by the op (`idempotency_key`): a
-- failed movement never posts, so a new generation can't double-post.

alter table public.outbound_ops
  add column attempt_gen integer not null default 0 check (attempt_gen >= 0),
  add column failed_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(failed_refs) = 'array');
comment on column public.outbound_ops.attempt_gen is
  'Attempt generation: provider idempotency key = idempotency_key (gen 0) or idempotency_key || '':r'' || gen. Bumped only by outbound_op.replay of an op whose current generation failed at the provider.';
comment on column public.outbound_ops.failed_refs is
  'Provider movements reported failed/canceled for this op: [{gen, ref, status, via, at}]. Never re-adopted, never posted.';

alter table public.pool_ops
  add column attempt_gen integer not null default 0 check (attempt_gen >= 0),
  add column failed_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(failed_refs) = 'array');
comment on column public.pool_ops.attempt_gen is
  'Attempt generation: provider idempotency key = idempotency_key (gen 0) or idempotency_key || '':r'' || gen; externalId = id or id || '':r'' || gen. Bumped only by pool_op.replay of an op whose current generation failed at the provider.';
comment on column public.pool_ops.failed_refs is
  'Provider movements reported failed/returned/canceled for this op: [{gen, ref, status, via, at}]. Never re-adopted, never posted.';

-- True when the op's current generation already has a provider movement reported failed (replay must start a new one).
create function public.op_gen_failed(p_failed_refs jsonb, p_gen integer) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements(p_failed_refs) e where (e ->> 'gen')::int = p_gen)
$$;
revoke execute on function public.op_gen_failed(jsonb, integer) from public, anon, authenticated;
