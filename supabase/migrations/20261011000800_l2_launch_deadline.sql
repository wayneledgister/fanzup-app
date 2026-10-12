-- Layer 2 (CR-002) · one stored offering deadline for a launch (PR #12 review rounds 2 and 3; design §5 "Launch").
-- The API plans the deadline before any provider call (`l2_plan_launch`: launch time + duration, persisted on the
-- Pool), sends it as the provider offering's end date and passes the same value into `launch_pool`, so the provider's
-- end date and the Pool's `ends_at` are one value and a retried launch replays identical provider parameters.
-- Every live Pool is open at least `min_offering_days` (review round 3): a retry whose plan leaves less than that
-- (or whose plan has passed) RE-PLANS the deadline from the retry's clock, and the API moves the provider offering's
-- end date to it (`updateOffering`, key `offering_end:<pool>:<deadline>`); `launch_pool` refuses a window shorter than
-- `min_offering_days` (`launch_window_too_short`), so a Pool can't go live with a shortened offering period.

alter table public.pools add column launch_ends_at timestamptz;
comment on column public.pools.launch_ends_at is
  'Planned offering deadline, set by l2_plan_launch before the provider calls (re-planned when less than min_offering_days remain); launch_pool copies it to ends_at.';

-- Plan (or re-read) the launch deadline. Owner only, Pool approved, under the owner-artist and Pool locks (§4.2 order).
-- The stored plan is reused while at least min_offering_days remain from p_now (a retry replays identical provider
-- parameters); otherwise — a retry days later, or after the planned deadline passed — the deadline is re-planned as
-- p_now + duration (review round 3), so a Pool can always be relaunched with a full offering period.
create function public.l2_plan_launch(p_pool uuid, p_user uuid, p_now timestamptz) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare p public.pools; v_ends timestamptz; v_min int;
begin
  perform public.l2_assert_enabled();
  if public.l2_owner(p_pool) is distinct from p_user then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  perform public.l2_lock_owner_artists(p_pool);
  select * into p from public.pools where id = p_pool for update;
  if p.status <> 'approved' then perform public.l2_fail('pool_not_approved', 'A Pool must pass Form C review before it can go live.'); end if;
  v_min := (select (value ->> 'min_offering_days')::int from public.platform_settings where key = 'regcf_limits');
  if p.duration_days < v_min then
    perform public.l2_fail('duration_too_short', format('A Pool must stay open for at least %s days.', v_min));
  end if;
  if p.launch_ends_at is not null and p.launch_ends_at >= p_now + make_interval(days => v_min) then return p.launch_ends_at; end if;
  v_ends := p_now + make_interval(days => p.duration_days);
  update public.pools set launch_ends_at = v_ends where id = p.id;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, case when p.launch_ends_at is null then 'pool.launch_planned' else 'pool.launch_replanned' end, 'pool', p.id,
          jsonb_build_object('ends_at', v_ends, 'previous_ends_at', p.launch_ends_at));
  return v_ends;
end $$;

-- launch_pool gains p_ends_at (default null keeps the 8-argument calls of the seed and the DB tests working). The Pool's
-- deadline is p_ends_at, else the planned one, else p_now + duration; a p_ends_at that differs from the planned one is
-- refused (`launch_deadline_mismatch`), and a deadline less than min_offering_days after p_now is refused
-- (`launch_window_too_short`, review round 3): every live Pool has ends_at − starts_at ≥ min_offering_days.
drop function public.launch_pool(uuid, uuid, text, text, text, text, bigint, timestamptz);
create function public.launch_pool(p_pool uuid, p_user uuid, p_issuer_ref text, p_offering_ref text, p_collection_ref text,
  p_legal_name text, p_other_regcf_12m_minor bigint, p_now timestamptz, p_ends_at timestamptz default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare p public.pools; v_issuer uuid; v_ends timestamptz; v_remaining bigint; v_min int;
begin
  perform public.l2_assert_enabled();
  if public.l2_owner(p_pool) is distinct from p_user then perform public.l2_fail('pool_not_found', 'We couldn''t find that Pool.'); end if;
  perform public.l2_lock_owner_artists(p_pool);
  select * into p from public.pools where id = p_pool for update;
  if p.status <> 'approved' then perform public.l2_fail('pool_not_approved', 'A Pool must pass Form C review before it can go live.'); end if;
  if p.terms_sha256 is distinct from public.l2_pool_terms_hash(p.id) then
    perform public.l2_fail('terms_changed', 'The Pool''s terms changed after it was reviewed. Resubmit it for review.');
  end if;
  v_min := (select (value ->> 'min_offering_days')::int from public.platform_settings where key = 'regcf_limits');
  if p.duration_days < v_min then
    perform public.l2_fail('duration_too_short', format('A Pool must stay open for at least %s days.', v_min));
  end if;
  if not exists (select 1 from public.collection_mechanisms where pool_id = p.id and status = 'executed') then
    perform public.l2_fail('collection_not_executed', 'The collection agreement must be executed before the Pool can go live.');
  end if;
  if p_other_regcf_12m_minor is null or p_other_regcf_12m_minor < 0 then
    perform public.l2_fail('attestation_required', 'Confirm your other Reg CF sales in the last 12 months (enter 0 if none).');
  end if;
  if p_ends_at is not null and p.launch_ends_at is not null and p_ends_at <> p.launch_ends_at then
    perform public.l2_fail('launch_deadline_mismatch', 'The offering deadline changed during launch. Try launching again.');
  end if;
  v_ends := coalesce(p_ends_at, p.launch_ends_at, p_now + make_interval(days => p.duration_days));
  if v_ends < p_now + make_interval(days => v_min) then
    perform public.l2_fail('launch_window_too_short', format('A Pool must stay open for at least %s days from launch. Launch again to set a new deadline.', v_min));
  end if;
  v_remaining := public.l2_issuer_cap_remaining(p.id, p_other_regcf_12m_minor, p_now);
  if v_remaining is null or p.max_minor > v_remaining then
    perform public.l2_fail('tier_cap_exceeded', format('You can raise up to %s more in Reg CF offerings in the next 12 months; this Pool''s maximum is %s.',
      public.l2_usd(greatest(coalesce(v_remaining, 0), 0)), public.l2_usd(p.max_minor)));
  end if;
  insert into public.issuers (artist_id, legal_name, provider_issuer_ref) values (p.artist_id, p_legal_name, p_issuer_ref)
  on conflict (artist_id) do update set provider_issuer_ref = coalesce(public.issuers.provider_issuer_ref, excluded.provider_issuer_ref)
  returning id into v_issuer;
  update public.pools set status = 'live', issuer_id = v_issuer, provider_offering_ref = p_offering_ref, provider_collection_ref = p_collection_ref,
         starts_at = p_now, ends_at = v_ends, launch_ends_at = v_ends, issuer_cap_remaining_minor = v_remaining,
         issuer_other_regcf_12m_minor = p_other_regcf_12m_minor, issuer_other_regcf_attested_at = p_now
   where id = p.id;
  insert into public.revenue_sources (pool_id, revenue_type, kind, name)
  select p.id, t, case p.collection_mechanism when 'LOCKBOX' then 'lockbox' when 'SELF_REPORT' then 'self_report'
                       when 'SPLIT_PAYEE' then 'split_payee' when 'LETTER_OF_DIRECTION' then 'letter_of_direction' else 'distributor' end,
         case t when 'master' then 'Distributor (mock)' when 'sync' then 'Sync licensing (mock)' else 'Publishing / PRO (mock)' end
    from unnest(p.revenue_types) t
  on conflict (pool_id, revenue_type) do nothing;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (p_user, 'pool.launched', 'pool', p.id, jsonb_build_object('offering_ref', p_offering_ref, 'ends_at', v_ends,
          'other_regcf_12m_minor', p_other_regcf_12m_minor, 'cap_remaining_minor', v_remaining));
  return v_ends;
end $$;

-- Service role only, like every Layer 2 function (0600; checked by the L2 grants test).
revoke execute on function public.l2_plan_launch(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.l2_plan_launch(uuid, uuid, timestamptz) to service_role;
revoke execute on function public.launch_pool(uuid, uuid, text, text, text, text, bigint, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.launch_pool(uuid, uuid, text, text, text, text, bigint, timestamptz, timestamptz) to service_role;
