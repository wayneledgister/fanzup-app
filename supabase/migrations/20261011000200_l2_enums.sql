-- Layer 2 (CR-002) · ledger account kinds for Reg CF Pools. Own file: a new enum value can't be used in the
-- transaction that adds it. Design specs/l2/02-design.md §3 (Ledger).
alter type public.ledger_account_kind add value if not exists 'pool_escrow';               -- asset: provider offering escrow
alter type public.ledger_account_kind add value if not exists 'pool_investor_liability';   -- owed to investors until close
alter type public.ledger_account_kind add value if not exists 'pool_issuer_payable';       -- owed to the creator after close
alter type public.ledger_account_kind add value if not exists 'pool_collection';           -- asset: provider collection account
alter type public.ledger_account_kind add value if not exists 'pool_revenue_suspense';     -- cash in, not yet reconciled
alter type public.ledger_account_kind add value if not exists 'pool_revenue_unallocated';  -- collected, distributable
alter type public.ledger_account_kind add value if not exists 'pool_distributions_payable';
alter type public.ledger_account_kind add value if not exists 'pool_creator_payable';
alter type public.ledger_account_kind add value if not exists 'pool_platform_payable';
