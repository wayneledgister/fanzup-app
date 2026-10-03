-- Layer 2 demo seed (CR-002) — LOCAL AND CI ONLY. Never run against a hosted project.
-- Loaded after seed.sql by `supabase db reset` (config.toml sql_paths). Matching provider state lives in
-- apps/mock-escrow/fixtures/layer2-seed.json (generated from this seed; a test proves they reconcile).
-- Fan accounts use the same local dev password as seed.sql. No staff-like account is added here.
--
-- Pools (one per risk badge):
--   Night Bloom (Nova Reyes)          live, filling          DISTRIBUTOR_REDIRECT · master          → More secure
--   Sol Sessions Vol. 1 (Sol Amara)   funded, 2 quarters paid LOCKBOX · master + sync                → Verified
--   Afterhours LP (Velvet Circuit)    failed, fully refunded  SELF_REPORT · master                   → Trust-based
--   Demo Tape EP (Nova Reyes)         matured: holders reached the return cap (council L2 condition 8)
-- Fans: Jordan (fan@, approved, $7,500 limit, $2,000 used), Ava (approved, $3,000 limit, $2,000 used), Ben (accredited),
--       Cleo (KYC rejected), Dev (manual review), Eli (not started).

insert into public.platform_settings (key, value) values ('flag.layer2', 'true')
on conflict (key) do update set value = 'true', updated_at = now();

-- ── Fan accounts ───────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, extensions.crypt('FanzupDev123', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('display_name', u.name, 'adult_attested', true, 'terms_version', '2026-10-03-beta', 'privacy_version', '2026-10-03-beta'),
       now(), now(), '', '', '', ''
  from (values
    ('5a1e0000-0000-4000-8000-00000000a1a1'::uuid, 'ava@fanzup.test', 'Ava Brooks'),
    ('5a1e0000-0000-4000-8000-00000000b2b2'::uuid, 'ben@fanzup.test', 'Ben Okafor'),
    ('5a1e0000-0000-4000-8000-00000000c3c3'::uuid, 'cleo@fanzup.test', 'Cleo Park'),
    ('5a1e0000-0000-4000-8000-00000000d4d4'::uuid, 'dev@fanzup.test', 'Dev Malhotra'),
    ('5a1e0000-0000-4000-8000-00000000e5e5'::uuid, 'eli@fanzup.test', 'Eli Santos')) as u(id, email, name);
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
  from auth.users where email in ('ava@fanzup.test', 'ben@fanzup.test', 'cleo@fanzup.test', 'dev@fanzup.test', 'eli@fanzup.test');

-- Investor profiles (provider party/account refs match the fixture). Income/net worth are fictional demo attestations.
insert into public.investor_profiles (user_id, kyc_status, provider_party_ref, provider_account_ref, provider_link_ref, state, annual_income_minor, net_worth_minor, accredited, certified_at, kyc_updated_at) values
  ('daba7ea1-c397-554c-87d4-ab17c5c4669e', 'approved',      'P_seed_jordan', 'A_seed_jordan', 'L_seed_jordan', 'AR',  9000000, 15000000, false, now() - interval '300 days', now() - interval '300 days'),
  ('5a1e0000-0000-4000-8000-00000000a1a1', 'approved',      'P_seed_ava',    'A_seed_ava',    'L_seed_ava',    'PA',  6000000,  4000000, false, now() - interval '30 days',  now() - interval '30 days'),
  ('5a1e0000-0000-4000-8000-00000000b2b2', 'approved',      'P_seed_ben',    'A_seed_ben',    'L_seed_ben',    'NJ', 40000000, 250000000, true, now() - interval '500 days', now() - interval '500 days'),
  ('5a1e0000-0000-4000-8000-00000000c3c3', 'rejected',      'P_seed_cleo',   'A_seed_cleo',   'L_seed_cleo',   'DE',  5000000,  2000000, false, now() - interval '10 days',  now() - interval '10 days'),
  ('5a1e0000-0000-4000-8000-00000000d4d4', 'manual_review', 'P_seed_dev',    'A_seed_dev',    'L_seed_dev',    'NY',  7000000,  3000000, false, now() - interval '2 days',   now() - interval '2 days');

-- ── Pools: drafts ──────────────────────────────────────────────────────
insert into public.pools (id, artist_id, slug, title, artist_display, genre, release_date, tracklist, story, risks, use_of_funds, revenue_types,
  fans_bps, creator_bps, platform_bps, units_total, unit_price_minor, min_units, target_minor, duration_days, return_cap_bps, maturity_months, collection_mechanism) values
  ('9001a000-0000-4000-8000-000000000001', 'c36385da-a6c6-532b-a362-360bfbe4b9f7', 'night-bloom', 'Night Bloom', 'Nova Reyes', 'Alt R&B', (now() + interval '200 days')::date,
   '["Intro (Dusk)", "Night Bloom", "Velvet Hour", "Slow Burn", "Lanterns", "Afterglow", "Outro (Dawn)"]',
   'My second album, recorded live with the full horn section. Fans who hold Units share in the master royalties for five years or until the cap.',
   'Release could slip if mixing runs long. Streaming income for independent albums is uncertain.',
   '[{"label": "Studio time (12 days)", "amountMinor": 900000}, {"label": "Mixing and mastering", "amountMinor": 600000}, {"label": "Session musicians", "amountMinor": 500000}]',
   '{master}', 3000, 6500, 500, 800, 5000, 1, 2000000, 30, 15000, 60, 'DISTRIBUTOR_REDIRECT'),
  ('9001a000-0000-4000-8000-000000000002', '8b5216b0-9616-5f1c-8013-6c409baebb52', 'sol-sessions-vol-1', 'Sol Sessions Vol. 1', 'Sol Amara', 'Afrobeats', (now() - interval '150 days')::date,
   '["Harmattan", "Little Rock Lagos", "Gold Coast", "Sunday Jollof", "Homeward"]',
   'Five songs cut live with my nine-piece band. Royalties from streaming and sync land in a lockbox account before I''m paid.',
   'Sync income is irregular. Lockbox only captures revenue paid into it.',
   '[{"label": "Recording", "amountMinor": 600000}, {"label": "Mixing", "amountMinor": 250000}, {"label": "Artwork and release", "amountMinor": 150000}]',
   '{master,sync}', 3000, 6500, 500, 200, 5000, 1, 1000000, 30, 15000, 60, 'LOCKBOX'),
  ('9001a000-0000-4000-8000-000000000003', '4640e639-ea55-507e-b76d-1665950cebc4', 'afterhours-lp', 'Afterhours LP', 'Velvet Circuit', 'Electronic', (now() + interval '90 days')::date,
   '["Warehouse", "Night Shift", "Strobe Choir", "4AM"]',
   'A club record made on hardware. Collection depends on my own royalty reports.',
   'Self-reported collection depends entirely on the artist.',
   '[{"label": "Studio and hardware rental", "amountMinor": 1500000}]',
   '{master}', 3000, 6500, 500, 600, 5000, 1, 1500000, 30, 15000, 60, 'SELF_REPORT'),
  ('9001a000-0000-4000-8000-000000000004', 'c36385da-a6c6-532b-a362-360bfbe4b9f7', 'demo-tape-ep', 'Demo Tape EP', 'Nova Reyes', 'Alt R&B', (now() - interval '380 days')::date,
   '["Basement One", "Basement Two", "Basement Three"]',
   'The first EP, pressed from bedroom demos. Fans received their full capped amount; the Pool has ended.',
   null,
   '[{"label": "Mastering and release", "amountMinor": 100000}]',
   '{master}', 6000, 3500, 500, 20, 5000, 1, 100000, 30, 15000, 60, 'DISTRIBUTOR_REDIRECT');

insert into public.pool_tranches (pool_id, seq, pct, milestone, evidence_required, target_date) values
  ('9001a000-0000-4000-8000-000000000001', 1, 50, null, null, null),
  ('9001a000-0000-4000-8000-000000000001', 2, 50, 'Album mastered and delivered to the distributor', 'Distributor delivery receipt', (now() + interval '180 days')::date),
  ('9001a000-0000-4000-8000-000000000002', 1, 60, null, null, null),
  ('9001a000-0000-4000-8000-000000000002', 2, 40, 'Album released on all platforms', 'Distributor release report', (now() + interval '30 days')::date),
  ('9001a000-0000-4000-8000-000000000003', 1, 50, null, null, null),
  ('9001a000-0000-4000-8000-000000000003', 2, 50, 'Album released', 'Release links', (now() + interval '120 days')::date),
  ('9001a000-0000-4000-8000-000000000004', 1, 50, null, null, null),
  ('9001a000-0000-4000-8000-000000000004', 2, 50, 'EP released', 'Release links', (now() - interval '370 days')::date);

insert into public.collection_mechanisms (pool_id, mechanism, revenue_types, badge, details)
select id, collection_mechanism, revenue_types, public.l2_risk_badge(collection_mechanism, revenue_types),
       jsonb_build_object('counterparty', case collection_mechanism when 'LOCKBOX' then 'Mock Lockbox Bank' when 'SELF_REPORT' then 'Artist (self-reported)' else 'Mock Distributor Inc.' end)
  from public.pools where id::text like '9001a000-%';

-- ── Walk each Pool through the real workflow and money functions ──────
do $seed$
declare
  reviewer constant uuid := 'b40e0a39-c7ef-5798-91f3-504e09b530f4';
  nova constant uuid := '7219e6d0-7ffb-51d4-b758-fa8d97b279f4';
  sol constant uuid := 'f147ba23-d0a1-562d-9140-267bc300c8c2';
  velvet constant uuid := '1455d378-8b48-5019-a0dd-7c5295930861';
  jordan constant uuid := 'daba7ea1-c397-554c-87d4-ab17c5c4669e';
  ava constant uuid := '5a1e0000-0000-4000-8000-00000000a1a1';
  ben constant uuid := '5a1e0000-0000-4000-8000-00000000b2b2';
  p_night constant uuid := '9001a000-0000-4000-8000-000000000001';
  p_sol constant uuid := '9001a000-0000-4000-8000-000000000002';
  p_velvet constant uuid := '9001a000-0000-4000-8000-000000000003';
  p_demo constant uuid := '9001a000-0000-4000-8000-000000000004';
  ack constant text := '2026-10-03-demo';
  r record; v_inv uuid; v_t uuid; v_close timestamptz; v_run uuid; v_amt bigint; v_doc jsonb; v_who text;
begin
  for r in select id, artist_id, (select owner_id from public.artists a where a.id = p.artist_id) as owner, title from public.pools p where id::text like '9001a000-%' order by id loop
    v_doc := jsonb_build_object('notice', 'DEMO — seeded mock Form C. Not filed with the SEC. Not an offer of securities.', 'pool', r.title);
    perform public.submit_pool(r.id, r.owner, v_doc, encode(extensions.digest(convert_to(v_doc::text, 'UTF8'), 'sha256'), 'hex'));
    perform public.review_pool(r.id, reviewer, 'approved', null);
    perform public.execute_collection_mechanism(r.id, reviewer, '{"executed": "seed"}');
  end loop;

  -- 1. Night Bloom — live and filling.
  perform public.launch_pool(p_night, nova, 'iss_seed_nova', 'off_seed_night', 'ca_seed_night', 'Nova Reyes Music LLC (demo issuer)');
  update public.pools set starts_at = now() - interval '9 days', ends_at = now() + interval '21 days' where id = p_night;
  select investment_id into v_inv from public.reserve_investment(ava, p_night, 20, ack);
  perform public.mark_investment_funding(v_inv, 'T_seed_ava_night', 'FM_seed_ava_night');
  perform public.record_investment_funded(v_inv, 'FM_seed_ava_night', 100000, 'fund:FM_seed_ava_night');
  select investment_id into v_inv from public.reserve_investment(ben, p_night, 100, ack);
  perform public.mark_investment_funding(v_inv, 'T_seed_ben_night', 'FM_seed_ben_night');
  perform public.record_investment_funded(v_inv, 'FM_seed_ben_night', 500000, 'fund:FM_seed_ben_night');

  -- 2. Sol Sessions — funded ~232 days ago, tranche 1 released, two quarters collected and distributed.
  perform public.launch_pool(p_sol, sol, 'iss_seed_sol', 'off_seed_sol', 'ca_seed_sol', 'Sol Amara Music LLC (demo issuer)');
  update public.pools set starts_at = now() - interval '262 days', ends_at = now() - interval '232 days' where id = p_sol;
  for r in select * from (values (jordan, 40, 'jordan'), (ben, 140, 'ben'), (ava, 20, 'ava')) as x(u, units, who) loop
    select investment_id into v_inv from public.reserve_investment(r.u, p_sol, r.units, ack, now() - interval '250 days');
    perform public.mark_investment_funding(v_inv, 'T_seed_' || r.who || '_sol', 'FM_seed_' || r.who || '_sol');
    perform public.record_investment_funded(v_inv, 'FM_seed_' || r.who || '_sol', r.units * 5000, 'fund:FM_seed_' || r.who || '_sol');
    update public.investments set created_at = now() - interval '250 days', funded_at = now() - interval '250 days' where id = v_inv;
  end loop;
  v_close := now() - interval '232 days' + interval '1 hour';
  perform public.settle_pool(p_sol, v_close);
  update public.pool_ops set status = 'confirmed', provider_ref = 'off_seed_sol' where pool_id = p_sol and kind = 'close_offering';
  select id into v_t from public.pool_tranches where pool_id = p_sol and seq = 1;
  perform public.record_pool_tranche_released(v_t, 'DB_seed_sol_1', public.pool_tranche_release_amount(v_t), 'disburse:' || v_t);
  update public.pool_ops set status = 'confirmed', provider_ref = 'DB_seed_sol_1' where kind = 'disburse' and subject_id = v_t;

  for r in select * from (values (1, 400000, 0, 92, 120), (2, 600000, 92, 184, 150)) as x(q, amt, d0, d1, paid) loop
    insert into public.revenue_statements (pool_id, period_label, period_start, period_end, lines, gross_minor, covered_minor, verification, sha256, uploaded_by)
    values (p_sol, 'Quarter ' || r.q, (v_close + make_interval(days => r.d0))::date, (v_close + make_interval(days => r.d1))::date,
            jsonb_build_array(jsonb_build_object('revenueType', 'master', 'source', 'Mock Distributor', 'amountMinor', r.amt * 3 / 4),
                              jsonb_build_object('revenueType', 'sync', 'source', 'Mock Sync Agency', 'amountMinor', r.amt / 4)),
            r.amt, r.amt, 'API_VERIFIED', encode(extensions.digest('seed:sol:' || r.q, 'sha256'), 'hex'), sol);
    perform public.record_collection_deposit(p_sol, 'DP_seed_sol_q' || r.q, r.amt, 'Quarter ' || r.q, v_close + make_interval(days => r.d1 + 20), 'deposit:DP_seed_sol_q' || r.q);
    perform public.reconcile_pool_revenue(p_sol, v_close + make_interval(days => r.d1 + 21));
    -- fans 30% split 40:140:20 by Units, platform 5%, creator the rest (exact, no rounding)
    v_run := public.commit_distribution_run(p_sol, 'Quarter ' || r.q, encode(extensions.digest('seed:sol:run:' || r.q, 'sha256'), 'hex'), jsonb_build_object(
      'runTotalMinor', r.amt,
      'payouts', (select jsonb_agg(jsonb_build_object('investmentId', i.id, 'amountMinor', (r.amt * 3000 / 10000) * i.units / 200) order by i.id)
                    from public.investments i where i.pool_id = p_sol and i.status = 'issued'),
      'creatorMinor', r.amt - r.amt * 3000 / 10000 - r.amt * 500 / 10000,
      'platformMinor', r.amt * 500 / 10000,
      'capOverflowMinor', 0), reviewer, v_close + make_interval(days => r.paid));
    for v_inv, v_amt, v_who in select d.id, d.amount_minor, coalesce(i.provider_trade_ref, d.kind) from public.distribution_payouts d left join public.investments i on i.id = d.investment_id where d.run_id = v_run loop
      perform public.record_pool_payout_confirmed(v_inv, 'PO_seed_sol_q' || r.q || '_' || v_who, v_amt, 'payout:' || v_inv);
      update public.pool_ops set status = 'confirmed', provider_ref = 'PO_seed_sol_q' || r.q || '_' || v_who where kind = 'payout' and subject_id = v_inv;
      update public.distribution_payouts set paid_at = v_close + make_interval(days => r.paid) where id = v_inv;
    end loop;
    update public.distribution_runs set committed_at = v_close + make_interval(days => r.paid) where id = v_run;
  end loop;
  perform public.reconcile_pool_revenue(p_sol, now());

  -- 3. Afterhours LP — missed its target; every investor refunded.
  perform public.launch_pool(p_velvet, velvet, 'iss_seed_velvet', 'off_seed_velvet', 'ca_seed_velvet', 'Velvet Circuit Music LLC (demo issuer)');
  update public.pools set starts_at = now() - interval '45 days', ends_at = now() - interval '15 days' where id = p_velvet;
  for r in select * from (values (jordan, 10, 'jordan'), (ava, 10, 'ava')) as x(u, units, who) loop
    select investment_id into v_inv from public.reserve_investment(r.u, p_velvet, r.units, ack, now() - interval '30 days');
    perform public.mark_investment_funding(v_inv, 'T_seed_' || r.who || '_velvet', 'FM_seed_' || r.who || '_velvet');
    perform public.record_investment_funded(v_inv, 'FM_seed_' || r.who || '_velvet', r.units * 5000, 'fund:FM_seed_' || r.who || '_velvet');
    update public.investments set created_at = now() - interval '30 days' where id = v_inv;
  end loop;
  perform public.settle_pool(p_velvet, now() - interval '15 days' + interval '1 hour');
  for v_inv, v_amt in select o.subject_id, o.amount_minor from public.pool_ops o where o.pool_id = p_velvet and o.kind = 'refund' loop
    perform public.record_investment_refunded(v_inv, 'RF_seed_' || (select provider_trade_ref from public.investments where id = v_inv), v_amt, 'refund:' || v_inv);
    update public.pool_ops set status = 'confirmed', provider_ref = 'RF_seed_' || (select provider_trade_ref from public.investments where id = v_inv) where kind = 'refund' and subject_id = v_inv;
  end loop;

  -- 4. Demo Tape EP — funded ~400 days ago; both tranches released; one large period took every holder to the cap.
  perform public.launch_pool(p_demo, nova, 'iss_seed_nova', 'off_seed_demo', 'ca_seed_demo', 'Nova Reyes Music LLC (demo issuer)');
  update public.pools set starts_at = now() - interval '430 days', ends_at = now() - interval '400 days' where id = p_demo;
  select investment_id into v_inv from public.reserve_investment(ben, p_demo, 20, ack, now() - interval '420 days');
  perform public.mark_investment_funding(v_inv, 'T_seed_ben_demo', 'FM_seed_ben_demo');
  perform public.record_investment_funded(v_inv, 'FM_seed_ben_demo', 100000, 'fund:FM_seed_ben_demo');
  update public.investments set created_at = now() - interval '420 days', funded_at = now() - interval '420 days' where id = v_inv;
  v_close := now() - interval '400 days' + interval '1 hour';
  perform public.settle_pool(p_demo, v_close);
  update public.pool_ops set status = 'confirmed', provider_ref = 'off_seed_demo' where pool_id = p_demo and kind = 'close_offering';
  select id into v_t from public.pool_tranches where pool_id = p_demo and seq = 1;
  perform public.record_pool_tranche_released(v_t, 'DB_seed_demo_1', public.pool_tranche_release_amount(v_t), 'disburse:' || v_t);
  update public.pool_ops set status = 'confirmed', provider_ref = 'DB_seed_demo_1' where kind = 'disburse' and subject_id = v_t;
  select id into v_t from public.pool_tranches where pool_id = p_demo and seq = 2;
  perform public.submit_pool_tranche_evidence(v_t, nova, 'EP released on all platforms (seed)', '{}');
  perform public.verify_pool_tranche(v_t, reviewer);
  perform public.record_pool_tranche_released(v_t, 'DB_seed_demo_2', public.pool_tranche_release_amount(v_t), 'disburse:' || v_t);
  update public.pool_ops set status = 'confirmed', provider_ref = 'DB_seed_demo_2' where kind = 'disburse' and subject_id = v_t;
  insert into public.revenue_statements (pool_id, period_label, period_start, period_end, lines, gross_minor, covered_minor, verification, sha256, uploaded_by)
  values (p_demo, 'Quarter 1', v_close::date, (v_close + interval '92 days')::date, '[{"revenueType": "master", "source": "Mock Distributor", "amountMinor": 300000}]',
          300000, 300000, 'API_VERIFIED', encode(extensions.digest('seed:demo:1', 'sha256'), 'hex'), nova);
  perform public.record_collection_deposit(p_demo, 'DP_seed_demo_q1', 300000, 'Quarter 1', v_close + interval '110 days', 'deposit:DP_seed_demo_q1');
  perform public.reconcile_pool_revenue(p_demo, v_close + interval '111 days');
  -- fans 60% of $3,000 = $1,800, but Ben's cap is 1.5 × $1,000 = $1,500: $300 overflow goes to the creator.
  v_run := public.commit_distribution_run(p_demo, 'Quarter 1', encode(extensions.digest('seed:demo:run:1', 'sha256'), 'hex'), jsonb_build_object(
    'runTotalMinor', 300000,
    'payouts', (select jsonb_agg(jsonb_build_object('investmentId', i.id, 'amountMinor', 150000)) from public.investments i where i.pool_id = p_demo),
    'creatorMinor', 135000, 'platformMinor', 15000, 'capOverflowMinor', 30000), reviewer, v_close + interval '120 days');
  for v_inv, v_amt, v_who in select d.id, d.amount_minor, coalesce(i.provider_trade_ref, d.kind) from public.distribution_payouts d left join public.investments i on i.id = d.investment_id where d.run_id = v_run loop
    perform public.record_pool_payout_confirmed(v_inv, 'PO_seed_demo_q1_' || v_who, v_amt, 'payout:' || v_inv);
    update public.pool_ops set status = 'confirmed', provider_ref = 'PO_seed_demo_q1_' || v_who where kind = 'payout' and subject_id = v_inv;
    update public.distribution_payouts set paid_at = v_close + interval '120 days' where id = v_inv;
  end loop;
  update public.distribution_runs set committed_at = v_close + interval '120 days' where id = v_run;
end
$seed$;

-- The seed's own notices were "sent" at seed time; mark them processed so a fresh worker doesn't replay old news.
update public.outbox set processed_at = now() where topic = 'l2.notify' and processed_at is null;
