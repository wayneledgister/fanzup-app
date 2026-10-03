-- Campaign workflow (callable by signed-in users) + Row Level Security.
-- Principle: clients read what they're allowed to see and edit their own drafts.
-- Every money movement goes through the API (service role) and the functions in 000200.

create function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

create function public.owns_artist(p_artist uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.artists where id = p_artist and owner_id = auth.uid())
$$;

create function public.owns_campaign(p_campaign uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.campaigns c join public.artists a on a.id = c.artist_id
                 where c.id = p_campaign and a.owner_id = auth.uid())
$$;

create function public.campaign_is_public(p_status public.campaign_status) returns boolean language sql immutable as $$
  select p_status in ('live', 'funded', 'failed', 'released', 'refunded', 'closed')
$$;

-- ── Workflow ───────────────────────────────────────────────────────────

-- Artist submits a draft for compliance review. Tier is assessed here (PRD 01 §6.3).
create function public.submit_campaign(p_campaign uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; a public.artists; v_cap bigint; v_pct int;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or not public.owns_campaign(p_campaign) then raise exception 'not found' using errcode = 'no_data_found'; end if;
  if c.status not in ('draft', 'revisions_requested') then raise exception 'campaign is %, cannot submit', c.status; end if;
  select * into a from public.artists where id = c.artist_id;
  if a.identity_status <> 'verified' then raise exception 'identity verification required before submitting'; end if;
  if not exists (select 1 from public.perks where campaign_id = c.id) then raise exception 'add at least one perk'; end if;
  select campaign_cap_minor into v_cap from public.tier_limits where tier = a.tier;
  if c.goal_minor > v_cap then raise exception '% campaigns can raise up to % cents', a.tier, v_cap; end if;

  if c.milestone_release then
    select coalesce(sum(pct), 0) into v_pct from public.campaign_tranches where campaign_id = c.id;
    if v_pct <> 100 then raise exception 'milestone tranches must add up to 100%% (got %)', v_pct; end if;
  else
    delete from public.campaign_tranches where campaign_id = c.id;
    perform public.ensure_single_tranche(c.id);
  end if;

  update public.campaigns set status = 'in_review', tier_at_submission = a.tier, cap_minor_at_submission = v_cap where id = c.id;
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'campaign.submitted', 'campaign', c.id, jsonb_build_object('tier', a.tier, 'goal_minor', c.goal_minor));
end $$;

-- Compliance reviewer decides (council checklist lives in `checklist`).
create function public.review_campaign(p_campaign uuid, p_decision text, p_checklist jsonb, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'reviewers only' using errcode = 'insufficient_privilege'; end if;
  if p_decision not in ('approved', 'revisions_requested') then raise exception 'invalid decision'; end if;
  if p_decision = 'revisions_requested' and coalesce(btrim(p_notes), '') = '' then raise exception 'explain what needs to change'; end if;
  update public.campaigns set status = p_decision::public.campaign_status where id = p_campaign and status = 'in_review';
  if not found then raise exception 'campaign is not in review'; end if;
  insert into public.campaign_reviews (campaign_id, reviewer_id, decision, checklist, notes)
  values (p_campaign, auth.uid(), p_decision, coalesce(p_checklist, '{}'), p_notes);
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'campaign.reviewed', 'campaign', p_campaign, jsonb_build_object('decision', p_decision));
end $$;

-- Artist launches an approved campaign; the clock starts now.
create function public.publish_campaign(p_campaign uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_ends timestamptz;
begin
  if not public.owns_campaign(p_campaign) then raise exception 'not found' using errcode = 'no_data_found'; end if;
  update public.campaigns
     set status = 'live', starts_at = now(), ends_at = now() + make_interval(days => duration_days)
   where id = p_campaign and status = 'approved'
  returning ends_at into v_ends;
  if v_ends is null then raise exception 'campaign must be approved before it can go live'; end if;
  insert into public.audit_events (actor_id, action, entity, entity_id) values (auth.uid(), 'campaign.published', 'campaign', p_campaign);
  return v_ends;
end $$;

-- ── Privileges ─────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new public functions to anon/authenticated by default. Lock money paths down.
revoke execute on function
  public.ledger_account(public.ledger_account_kind, uuid),
  public.ledger_post(text, text, jsonb, uuid, uuid, text, text),
  public.ledger_balance(uuid),
  public.record_backing_captured(uuid, text, bigint, text),
  public.settle_campaign(uuid, timestamptz),
  public.record_backing_refunded(uuid, text, text),
  public.verify_tranche(uuid, uuid),
  public.record_tranche_released(uuid, text, text),
  public.tranche_release_amount(uuid),
  public.ensure_single_tranche(uuid),
  public.handle_new_user()
from public, anon, authenticated;
grant execute on function
  public.ledger_account(public.ledger_account_kind, uuid),
  public.ledger_post(text, text, jsonb, uuid, uuid, text, text),
  public.ledger_balance(uuid),
  public.record_backing_captured(uuid, text, bigint, text),
  public.settle_campaign(uuid, timestamptz),
  public.record_backing_refunded(uuid, text, text),
  public.verify_tranche(uuid, uuid),
  public.record_tranche_released(uuid, text, text),
  public.tranche_release_amount(uuid),
  public.ensure_single_tranche(uuid)
to service_role;

revoke execute on function public.submit_campaign(uuid), public.publish_campaign(uuid),
  public.review_campaign(uuid, text, jsonb, text) from public, anon;
grant execute on function public.submit_campaign(uuid), public.publish_campaign(uuid),
  public.review_campaign(uuid, text, jsonb, text) to authenticated;

-- Internal tables: no client access at all.
revoke all on public.ledger_accounts, public.ledger_transactions, public.ledger_entries, public.ledger_balances,
  public.audit_events, public.outbox, public.api_idempotency, public.staff, public.campaign_transitions
from anon, authenticated;
grant select on public.tier_limits to anon, authenticated;

-- Column-level write grants: clients can never set counters, status, tier or money fields.
revoke insert, update, delete on public.profiles, public.artists, public.campaigns, public.campaign_tranches,
  public.perks, public.backings, public.fulfillments, public.campaign_reviews, public.tier_limits from anon, authenticated;
grant update (handle, display_name, city, bio) on public.profiles to authenticated;
grant insert (owner_id, slug, name, genre, city, bio) on public.artists to authenticated;
grant update (slug, name, genre, city, bio) on public.artists to authenticated;
grant insert (artist_id, slug, title, type, blurb, story, risks, goal_minor, milestone_release, duration_days) on public.campaigns to authenticated;
grant update (slug, title, type, blurb, story, risks, goal_minor, milestone_release, duration_days) on public.campaigns to authenticated;
grant delete on public.campaigns to authenticated;
grant insert (campaign_id, seq, pct, milestone, evidence_required, target_date) on public.campaign_tranches to authenticated;
grant update (pct, milestone, evidence_required, target_date) on public.campaign_tranches to authenticated;
grant delete on public.campaign_tranches to authenticated;
grant insert (campaign_id, title, description, kind, price_minor, quantity_limit, fulfill_by, ships_to, sort) on public.perks to authenticated;
grant update (title, description, kind, price_minor, quantity_limit, fulfill_by, ships_to, sort) on public.perks to authenticated;
grant delete on public.perks to authenticated;
grant update (status, tracking, note) on public.fulfillments to authenticated;

-- ── Row Level Security ─────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.artists enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_tranches enable row level security;
alter table public.perks enable row level security;
alter table public.backings enable row level security;
alter table public.fulfillments enable row level security;
alter table public.campaign_reviews enable row level security;
alter table public.staff enable row level security;
alter table public.tier_limits enable row level security;
alter table public.campaign_transitions enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_events enable row level security;
alter table public.outbox enable row level security;
alter table public.api_idempotency enable row level security;
-- (ledger/audit/outbox/idempotency/staff/transitions: RLS on, no policies → only service_role.)

create policy tier_limits_read on public.tier_limits for select using (true);

create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy artists_read on public.artists for select using (true);
create policy artists_insert_own on public.artists for insert with check (owner_id = auth.uid());
create policy artists_update_own on public.artists for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy campaigns_read on public.campaigns for select
  using (public.campaign_is_public(status) or public.owns_artist(artist_id) or public.is_staff());
create policy campaigns_insert_own on public.campaigns for insert
  with check (public.owns_artist(artist_id) and status = 'draft');
create policy campaigns_update_draft on public.campaigns for update
  using (public.owns_artist(artist_id) and status in ('draft', 'revisions_requested'))
  with check (public.owns_artist(artist_id) and status in ('draft', 'revisions_requested'));
create policy campaigns_delete_draft on public.campaigns for delete
  using (public.owns_artist(artist_id) and status = 'draft');

create policy tranches_read on public.campaign_tranches for select
  using (exists (select 1 from public.campaigns c where c.id = campaign_id
                 and (public.campaign_is_public(c.status) or public.owns_artist(c.artist_id) or public.is_staff())));
create policy tranches_write_draft on public.campaign_tranches for all
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.owns_artist(c.artist_id) and c.status in ('draft', 'revisions_requested')))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and public.owns_artist(c.artist_id) and c.status in ('draft', 'revisions_requested')));

create policy perks_read on public.perks for select
  using (exists (select 1 from public.campaigns c where c.id = campaign_id
                 and (public.campaign_is_public(c.status) or public.owns_artist(c.artist_id) or public.is_staff())));
create policy perks_write_draft on public.perks for all
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.owns_artist(c.artist_id) and c.status in ('draft', 'revisions_requested')))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and public.owns_artist(c.artist_id) and c.status in ('draft', 'revisions_requested')));

-- Backers see their own backings; artists see backings on their campaigns. Nobody inserts from the client.
create policy backings_read on public.backings for select
  using (backer_id = auth.uid() or public.owns_campaign(campaign_id) or public.is_staff());

create policy fulfillments_read on public.fulfillments for select
  using (exists (select 1 from public.backings b where b.id = backing_id
                 and (b.backer_id = auth.uid() or public.owns_campaign(b.campaign_id) or public.is_staff())));
create policy fulfillments_artist_update on public.fulfillments for update
  using (exists (select 1 from public.backings b where b.id = backing_id and public.owns_campaign(b.campaign_id)))
  with check (exists (select 1 from public.backings b where b.id = backing_id and public.owns_campaign(b.campaign_id)));

create policy reviews_read on public.campaign_reviews for select
  using (public.is_staff() or public.owns_campaign(campaign_id));

-- Public read model for discovery: never exposes backer identities.
create view public.campaign_cards with (security_invoker = true) as
  select c.id, c.slug, c.title, c.type, c.blurb, c.status, c.goal_minor, c.raised_minor, c.backers_count,
         c.ends_at, c.milestone_release, a.id as artist_id, a.slug as artist_slug, a.name as artist_name,
         a.genre, a.city, a.tier
  from public.campaigns c join public.artists a on a.id = c.artist_id
  where public.campaign_is_public(c.status);
grant select on public.campaign_cards to anon, authenticated;
