-- M1 · identity (18+ attestation, consents), funnel events, notifications log, single-operator staff actions,
-- fan money view, workflow hardening. Design 02 §3.5–§3.7, §9; FR-ID-006/007, FR-PRV-001, FR-NTF-001, FR-ANL-001.

-- ── Current legal document versions (mirrors packages/shared POLICY.legal; a sync test keeps them equal) ──
insert into public.platform_settings (key, value)
values ('legal_versions', '{"terms": "2026-10-03-beta", "privacy": "2026-10-03-beta"}');

-- ── Consents (FR-PRV-001, FR-ID-006). Append-only. ─────────────────────
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'adult_attestation')),
  version text not null,
  method text not null check (method in ('signup', 'api')),
  ip inet,
  user_agent text check (char_length(user_agent) <= 400),
  created_at timestamptz not null default now()
);
create index consents_user_idx on public.consents (user_id, kind);
create trigger consents_no_change before update on public.consents for each row execute function public.ledger_append_only();

-- Does the user hold an acceptance of every current document (and an 18+ attestation)?
create function public.missing_acceptances(p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  with v as (select value from public.platform_settings where key = 'legal_versions')
  select coalesce(array_agg(k), '{}') from (
    select 'terms' as k where not exists (select 1 from public.consents c, v where c.user_id = p_user and c.kind = 'terms' and c.version = v.value ->> 'terms')
    union all
    select 'privacy' where not exists (select 1 from public.consents c, v where c.user_id = p_user and c.kind = 'privacy' and c.version = v.value ->> 'privacy')
    union all
    select 'adult_attestation' where not exists (select 1 from public.consents c where c.user_id = p_user and c.kind = 'adult_attestation')
  ) m
$$;

-- ── Funnel events (FR-ANL-001 events; first-party, server-side only — G1 N16) ──
create table public.funnel_events (
  id bigint generated always as identity primary key,
  name text not null check (name in ('perk_selected', 'checkout_started', 'account_created', 'backing_confirmed')),
  campaign_id uuid references public.campaigns (id),
  perk_id uuid references public.perks (id),
  user_id uuid,
  anon_id uuid,
  source text check (source is null or source ~ '^[a-z0-9_-]{1,40}$'),
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now()
);
create index funnel_events_campaign_idx on public.funnel_events (campaign_id, name, created_at);

create function public.backing_funnel() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.funnel_events (name, campaign_id, perk_id, user_id, source) values ('checkout_started', new.campaign_id, new.perk_id, new.backer_id, new.source);
  elsif new.status = 'held' and old.status = 'pending_payment' then
    insert into public.funnel_events (name, campaign_id, perk_id, user_id, source) values ('backing_confirmed', new.campaign_id, new.perk_id, new.backer_id, new.source);
  end if;
  return null;
end $$;
create trigger backings_funnel after insert or update of status on public.backings for each row execute function public.backing_funnel();

-- ── New users: 18+ attestation and current terms are required (FR-ID-006; card G1-B option 3) ──
-- The sign-up form sends adult_attested, terms_version and privacy_version as user metadata. A user created
-- without them (e.g. "Add user" in the Supabase dashboard) is refused by design (design §12.2).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb := (select value from public.platform_settings where key = 'legal_versions');
        m jsonb := coalesce(new.raw_user_meta_data, '{}');
begin
  if coalesce((m ->> 'adult_attested')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'adult_attestation_required', detail = 'You must confirm you are 18 or older to create an account.';
  end if;
  if m ->> 'terms_version' is distinct from v ->> 'terms' or m ->> 'privacy_version' is distinct from v ->> 'privacy' then
    raise exception using errcode = 'P0001', message = 'terms_version_mismatch', detail = 'Please reload the page and accept the current terms.';
  end if;
  insert into public.profiles (id, display_name) values (new.id, coalesce(m ->> 'display_name', ''));
  insert into public.consents (user_id, kind, version, method) values
    (new.id, 'adult_attestation', 'v1', 'signup'),
    (new.id, 'terms', v ->> 'terms', 'signup'),
    (new.id, 'privacy', v ->> 'privacy', 'signup');
  insert into public.funnel_events (name, user_id, anon_id, source)
  values ('account_created', new.id,
          case when m ->> 'anon_id' ~ '^[0-9a-f-]{36}$' then (m ->> 'anon_id')::uuid end,
          case when m ->> 'source' ~ '^[a-z0-9_-]{1,40}$' then m ->> 'source' end);
  return new;
end $$;

-- ── Notifications log (FR-NTF-001). The address is resolved at send time and never stored here. ──
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  template_version integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid,
  dedupe_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  transport text,
  error text,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- ── Single-operator staff actions (FR-ID-007, card G1-A option 1) ──────
create table public.privileged_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  subject_id uuid,
  actor_id uuid not null references public.profiles (id),
  aal text not null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  amount_minor bigint,
  params jsonb not null default '{}',
  status text not null default 'scheduled' check (status in ('scheduled', 'executed', 'cancelled', 'failed')),
  execute_after timestamptz not null default now(),
  executed_at timestamptz,
  error text,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now()
);
create index privileged_actions_due_idx on public.privileged_actions (execute_after) where status = 'scheduled';
create index privileged_actions_day_idx on public.privileged_actions (action, created_at);

create table public.review_signoffs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  actor_id uuid not null references public.profiles (id),
  note text,
  action_count integer not null,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now()
);

-- ── Workflow hardening ─────────────────────────────────────────────────
-- Reviewer ≠ owner (FR-ID-003). Callable by the API only (NFR-SEC-02 slice); auth.uid() is the verified actor.
create or replace function public.review_campaign(p_campaign uuid, p_decision text, p_checklist jsonb, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'reviewers only' using errcode = 'insufficient_privilege'; end if;
  if public.owns_campaign(p_campaign) then
    raise exception using errcode = 'P0001', message = 'reviewer_is_owner', detail = 'You can''t review a campaign you own.';
  end if;
  if p_decision not in ('approved', 'revisions_requested') then raise exception 'invalid decision'; end if;
  if p_decision = 'revisions_requested' and coalesce(btrim(p_notes), '') = '' then raise exception 'explain what needs to change'; end if;
  update public.campaigns set status = p_decision::public.campaign_status where id = p_campaign and status = 'in_review';
  if not found then raise exception using errcode = 'P0001', message = 'campaign_not_in_review', detail = 'This campaign isn''t waiting for review.'; end if;
  insert into public.campaign_reviews (campaign_id, reviewer_id, decision, checklist, notes)
  values (p_campaign, auth.uid(), p_decision, coalesce(p_checklist, '{}'), p_notes);
  insert into public.audit_events (actor_id, action, entity, entity_id, data)
  values (auth.uid(), 'campaign.reviewed', 'campaign', p_campaign, jsonb_build_object('decision', p_decision));
end $$;

revoke execute on function public.submit_campaign(uuid), public.publish_campaign(uuid), public.review_campaign(uuid, text, jsonb, text)
  from authenticated;
grant execute on function public.submit_campaign(uuid), public.publish_campaign(uuid), public.review_campaign(uuid, text, jsonb, text)
  to service_role;

-- ── Fan view of backings (FR-BCK-005, FR-PAY-009 fan slice). Money state derived from the ledger. ──
create function public.fan_backings(p_user uuid)
returns table (
  id uuid, created_at timestamptz, amount_minor bigint, quantity smallint, status text, money_state text, released_pct integer,
  refund_minor bigint, refunded_at timestamptz, refund_ref text,
  campaign_id uuid, campaign_slug text, campaign_title text, campaign_status text, ends_at timestamptz, goal_minor bigint, raised_minor bigint,
  perk_title text, perk_fulfill_by date, next_label text, next_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with b as (
    select b.*,
           exists (select 1 from public.ledger_transactions t where t.backing_id = b.id and t.kind = 'backing.captured') as captured,
           (select t.created_at from public.ledger_transactions t where t.backing_id = b.id and t.kind = 'backing.refunded') as refunded_at
      from public.backings b where b.backer_id = p_user
  ), rel as (
    select c.id as campaign_id,
           coalesce((select sum(t.released_minor) from public.campaign_tranches t where t.campaign_id = c.id and t.status = 'released'), 0) as released,
           c.raised_minor - coalesce((select sum(x.processing_fee_minor) from public.backings x where x.campaign_id = c.id and x.counted), 0) as net
      from public.campaigns c
  )
  select b.id, b.created_at, b.amount_minor, b.quantity, b.status::text,
         case
           when b.refunded_at is not null then 'refunded'
           when b.status = 'refund_pending' then 'refunding'
           when b.status = 'pending_payment' then 'pending'
           when b.status in ('canceled', 'payment_failed') then 'canceled'
           when not b.captured then 'pending'
           when c.status = 'live' then 'held'
           when c.status = 'failed' then 'refunding'
           when c.status = 'funded' then 'with_artist'
           when c.status in ('released', 'closed') then 'released'
           else 'held' end,
         -- campaign-level share released to the artist (G2 condition 4), not a per-backing figure
         case when rel.net > 0 then least(100, (rel.released * 100 / rel.net))::integer else 0 end,
         case when b.refunded_at is not null then b.captured_minor end, b.refunded_at, b.refund_ref,
         c.id, c.slug::text, c.title, c.status::text, c.ends_at, c.goal_minor, c.raised_minor,
         p.title, p.fulfill_by,
         case
           when b.refunded_at is not null then null
           when b.status = 'refund_pending' or c.status = 'failed' then 'Refund on its way'
           when c.status = 'live' then 'Campaign ends'
           when c.status = 'funded' then 'Next milestone'
           else null end,
         case
           when c.status = 'live' and b.refunded_at is null and b.status <> 'refund_pending' then c.ends_at
           when c.status = 'funded' then (select min(t.target_date)::timestamptz from public.campaign_tranches t where t.campaign_id = c.id and t.status <> 'released')
           else null end
    from b join public.campaigns c on c.id = b.campaign_id join public.perks p on p.id = b.perk_id join rel on rel.campaign_id = c.id
   where b.status <> 'canceled' or b.captured
   order by b.created_at desc
$$;

-- ── RLS + privileges ───────────────────────────────────────────────────
alter table public.consents enable row level security;
alter table public.funnel_events enable row level security;
alter table public.notifications enable row level security;
alter table public.privileged_actions enable row level security;
alter table public.review_signoffs enable row level security;
revoke all on public.consents, public.funnel_events, public.notifications, public.privileged_actions, public.review_signoffs
  from anon, authenticated;
revoke execute on function public.missing_acceptances(uuid), public.backing_funnel(), public.fan_backings(uuid) from public, anon, authenticated;
grant execute on function public.missing_acceptances(uuid), public.fan_backings(uuid) to service_role;
