-- Layer 2 (CR-002) · helpers the API layer (PR #12) needs on top of the merged money functions (0200–0600).
-- Design specs/l2/02-design.md §3 (counted reservation), §4.2 (lock order), §5 (purchase resume guard, outbound ops).

-- Purchase resume guard case (c) (design §5): mark that a provider call is about to start for a reservation, in its own
-- committed transaction before the first createTrade/fundTrade. Lock order pool → investment (§4.2). The marker is set
-- only for a LIVE reservation (l2_reservation_live: reserved, unexpired, no pending cancel, Pool live before ends_at),
-- so a reservation that has left the count can never re-enter it through a provider call (§3). A cancel racing this
-- serialises on the investment lock: either the cancel sees no call (immediate cancel; this returns 'not_live' and the
-- API makes no call) or it sees the marker (cancel_pending). Returns 'started' (marker set now or already set) or
-- 'not_live' (the API re-runs the guard).
create function public.l2_start_provider_call(p_inv uuid, p_now timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare v_pool uuid; i public.investments; p public.pools;
begin
  select pool_id into v_pool from public.investments where id = p_inv;
  if not found then perform public.l2_fail('investment_not_found', 'No such investment.'); end if;
  select * into p from public.pools where id = v_pool for update;
  select * into i from public.investments where id = p_inv for update;
  if not public.l2_reservation_live(i, p, p_now) then return 'not_live'; end if;
  update public.investments set provider_call_started_at = coalesce(provider_call_started_at, p_now) where id = i.id;
  if i.provider_call_started_at is null then
    insert into public.audit_events (action, entity, entity_id) values ('investment.provider_call_started', 'investment', i.id);
  end if;
  return 'started';
end $$;

-- Service role only, like every Layer 2 function (0600; checked by the L2 grants test).
revoke execute on function public.l2_start_provider_call(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.l2_start_provider_call(uuid, timestamptz) to service_role;
