-- Agent layer, Phase 0 (CR-003, specs/agents/02-design.md §2, ADR-008).
-- Agents are advisory: they read a few views and write only their own tables, as the Postgres role `fanzup_agent`.
-- Nothing here changes an existing table's data or any money function.

-- ── Role ────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fanzup_agent') then create role fanzup_agent nologin noinherit; end if;
end $$;
-- The connecting owner switches to it per transaction (`set local role fanzup_agent`), as asService does for service_role.
grant fanzup_agent to current_user;
grant usage on schema public to fanzup_agent;

-- ── Flag (FR-AGT-F-002) ─────────────────────────────────────────────────
insert into public.platform_settings (key, value) values ('flag.agents', 'false') on conflict (key) do nothing;
create function public.agents_enabled() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = 'flag.agents'), false)
$$;

-- ── Tasks (FR-AGT-F-003) ────────────────────────────────────────────────
create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('campaign_review', 'ops_weekly')),
  subject_kind text not null check (subject_kind in ('campaign', 'week')),
  subject_id uuid,
  subject_key text not null,
  dedupe_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_tasks_due_idx on public.agent_tasks (available_at) where status in ('queued', 'running');
create trigger agent_tasks_touch before update on public.agent_tasks for each row execute function public.touch_updated_at();

-- ── Runs (FR-AGT-F-004): append-only ───────────────────────────────────
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agent_tasks (id),
  agent text not null,
  attempt integer not null,
  model text,
  prompt_version text not null,
  input_digest text,
  status text not null check (status in ('succeeded', 'failed', 'skipped')),
  usage jsonb not null default '{}',
  error_code text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  actor_kind text not null default coalesce(public.ctx('actor_kind'), 'system:db'),
  correlation_id text default public.ctx('correlation_id')
);
create index agent_runs_task_idx on public.agent_runs (task_id);
create trigger agent_runs_no_change before update or delete on public.agent_runs for each row execute function public.ledger_append_only();

-- ── Proposals (FR-AGT-F-005) ────────────────────────────────────────────
create table public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agent_tasks (id),
  run_id uuid not null references public.agent_runs (id),
  agent text not null,
  subject_kind text not null,
  subject_id uuid,
  subject_key text not null,
  kind text not null check (kind in ('review_packet', 'weekly_pack')),
  source text not null check (source in ('model', 'deterministic')),
  body jsonb not null,
  status text not null default 'open' check (status in ('open', 'superseded')),
  verdict text check (verdict in ('agree', 'partial', 'disagree')),
  verdict_note text check (verdict_note is null or char_length(verdict_note) <= 2000),
  verdict_by uuid references public.profiles (id),
  verdict_at timestamptz,
  correlation_id text default public.ctx('correlation_id'),
  created_at timestamptz not null default now(),
  check ((verdict is null) = (verdict_at is null) and (verdict is null) = (verdict_by is null))
);
create index agent_proposals_subject_idx on public.agent_proposals (subject_key, created_at desc);
create index agent_proposals_agent_idx on public.agent_proposals (agent, created_at desc);

-- Only two changes are ever allowed: open → superseded, and a verdict set once (by the API as service_role).
create function public.agent_proposals_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'agent proposals are append-only' using errcode = 'insufficient_privilege'; end if;
  if (new.id, new.task_id, new.run_id, new.agent, new.subject_kind, new.subject_id, new.subject_key, new.kind, new.source, new.body, new.correlation_id, new.created_at)
     is distinct from (old.id, old.task_id, old.run_id, old.agent, old.subject_kind, old.subject_id, old.subject_key, old.kind, old.source, old.body, old.correlation_id, old.created_at) then
    raise exception 'agent proposal content is immutable' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status and not (old.status = 'open' and new.status = 'superseded') then
    raise exception 'invalid proposal status change' using errcode = 'insufficient_privilege';
  end if;
  if (new.verdict, new.verdict_note, new.verdict_by, new.verdict_at) is distinct from (old.verdict, old.verdict_note, old.verdict_by, old.verdict_at) then
    if old.verdict is not null then raise exception 'proposal already has a verdict' using errcode = 'unique_violation'; end if;
    if current_user = 'fanzup_agent' then raise exception 'agents cannot record verdicts' using errcode = 'insufficient_privilege'; end if;
  end if;
  return new;
end $$;
create trigger agent_proposals_guard before update or delete on public.agent_proposals for each row execute function public.agent_proposals_guard();

-- Audit every proposal (NFR-COMP-11); the context's actor kind is system:agent:<name>.
create function public.agent_proposals_audit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (action, entity, entity_id, data)
    values ('agent.proposal.created', 'agent_proposal', new.id,
            jsonb_build_object('agent', new.agent, 'subject_kind', new.subject_kind, 'subject_id', new.subject_id, 'source', new.source, 'run_id', new.run_id));
  elsif new.verdict is distinct from old.verdict then
    insert into public.audit_events (actor_id, action, entity, entity_id, data)
    values (new.verdict_by, 'agent.proposal.verdict', 'agent_proposal', new.id, jsonb_build_object('agent', new.agent, 'verdict', new.verdict));
  end if;
  return new;
end $$;
create trigger agent_proposals_audit after insert or update on public.agent_proposals for each row execute function public.agent_proposals_audit();

-- ── Enqueue on submission (FR-AGT-A1-001) ──────────────────────────────
create function public.agent_enqueue_campaign_review() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.agent_tasks (agent, subject_kind, subject_id, subject_key, dedupe_key)
  values ('campaign_review', 'campaign', new.id, 'campaign:' || new.id,
          'campaign_review:' || new.id || ':' || (extract(epoch from clock_timestamp()) * 1000000)::bigint)
  on conflict (dedupe_key) do nothing;
  return new;
end $$;
create trigger campaigns_agent_review after update of status on public.campaigns for each row
  when (new.status = 'in_review' and old.status is distinct from 'in_review')
  execute function public.agent_enqueue_campaign_review();

-- ── Views the agent may read (NFR-AGT-02: no personal data beyond display names) ──
create view public.agent_v_campaign as
  select c.id, c.slug, c.title, c.type, c.blurb, c.story, c.risks, c.goal_minor, c.currency, c.status, c.milestone_release,
         c.duration_days, c.tier_at_submission, c.cap_minor_at_submission, c.updated_at,
         a.name as artist_name, a.tier as artist_tier, a.identity_status as artist_identity_status,
         (select count(*) from public.campaigns o where o.artist_id = c.artist_id and o.id <> c.id) as artist_other_campaigns,
         (select count(*) from public.campaigns o where o.artist_id = c.artist_id and o.id <> c.id and o.status in ('funded', 'released')) as artist_funded_campaigns
    from public.campaigns c join public.artists a on a.id = c.artist_id;

create view public.agent_v_campaign_perks as
  select p.id, p.campaign_id, p.title, p.description, p.kind, p.price_minor, p.quantity_limit, p.fulfill_by, p.ships_to, p.sort
    from public.perks p;

create view public.agent_v_campaign_tranches as
  select t.id, t.campaign_id, t.seq, t.pct, t.milestone, t.evidence_required, t.target_date
    from public.campaign_tranches t;

-- Weekly review (FR-ID-007): actions without the free-text reason (it can name people).
create view public.agent_v_weekly_actions as
  select pa.id, pa.action, pa.subject_id, pa.status, pa.amount_minor, pa.execute_after, pa.executed_at, pa.created_at,
         (pa.error is not null) as has_error
    from public.privileged_actions pa;

create view public.agent_v_week_signoffs as
  select s.week_start, s.action_count, s.created_at from public.review_signoffs s;

create view public.agent_v_ops_snapshot as
  select
    (select count(*) from public.campaigns where status = 'in_review') as campaigns_in_review,
    (select min(updated_at) from public.campaigns where status = 'in_review') as oldest_review_since,
    (select count(*) from public.campaign_tranches where status = 'evidence_submitted') as evidence_waiting,
    (select count(*) from public.outbound_ops where status in ('dead', 'failed')) as money_dead_letters,
    (select count(*) from public.recon_breaks where resolved_at is null) as open_recon_breaks,
    (select count(*) from public.agent_tasks where status = 'dead') as agent_dead_tasks,
    -- Inline (not public.single_operator_mode()): the agent role has no execute grant on staff functions.
    coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = 'single_operator_mode'), true) as single_operator_mode;

-- ── Grants: exactly this, nothing else (FR-AGT-F-001; asserted by apps/api/test/agents-privileges.test.ts) ──
revoke all on public.agent_tasks, public.agent_runs, public.agent_proposals,
  public.agent_v_campaign, public.agent_v_campaign_perks, public.agent_v_campaign_tranches,
  public.agent_v_weekly_actions, public.agent_v_week_signoffs, public.agent_v_ops_snapshot from anon, authenticated;
grant select on public.agent_v_campaign, public.agent_v_campaign_perks, public.agent_v_campaign_tranches,
  public.agent_v_weekly_actions, public.agent_v_week_signoffs, public.agent_v_ops_snapshot to fanzup_agent;
grant select, insert on public.agent_tasks to fanzup_agent;
grant update (status, attempts, available_at, lease_until, last_error) on public.agent_tasks to fanzup_agent;
grant select, insert on public.agent_runs, public.agent_proposals to fanzup_agent;
grant update (status) on public.agent_proposals to fanzup_agent;
grant execute on function public.ctx(text), public.agents_enabled() to fanzup_agent;
revoke execute on function public.agents_enabled() from public, anon, authenticated;
grant execute on function public.agents_enabled() to service_role;
alter table public.agent_tasks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_proposals enable row level security;
create policy agent_tasks_agent on public.agent_tasks to fanzup_agent using (true) with check (true);
create policy agent_runs_agent on public.agent_runs to fanzup_agent using (true) with check (true);
create policy agent_proposals_agent on public.agent_proposals to fanzup_agent using (true) with check (true);
-- The agent writes its own heartbeat row only (NFR-AGT-06).
grant select, insert, update (beat_at, info) on public.worker_heartbeats to fanzup_agent;
create policy worker_heartbeats_agent on public.worker_heartbeats to fanzup_agent using (worker = 'agents') with check (worker = 'agents');
