-- Local/dev seed only. Never run against production. Password for all users: FanzupDev123
-- Fictional artists matching the web prototype (apps/web/src/lib/mock.ts).

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '7219e6d0-7ffb-51d4-b758-fa8d97b279f4', 'authenticated', 'authenticated', 'nova@fanzup.test', extensions.crypt('FanzupDev123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Nova Reyes"}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('7219e6d0-7ffb-51d4-b758-fa8d97b279f4', '7219e6d0-7ffb-51d4-b758-fa8d97b279f4', '7219e6d0-7ffb-51d4-b758-fa8d97b279f4', '{"sub":"7219e6d0-7ffb-51d4-b758-fa8d97b279f4","email":"nova@fanzup.test"}', 'email', now(), now(), now());
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '062523d9-b8c6-5b22-b3a4-b0114d619137', 'authenticated', 'authenticated', 'lowends@fanzup.test', extensions.crypt('FanzupDev123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"The Low Ends"}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('062523d9-b8c6-5b22-b3a4-b0114d619137', '062523d9-b8c6-5b22-b3a4-b0114d619137', '062523d9-b8c6-5b22-b3a4-b0114d619137', '{"sub":"062523d9-b8c6-5b22-b3a4-b0114d619137","email":"lowends@fanzup.test"}', 'email', now(), now(), now());
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'f147ba23-d0a1-562d-9140-267bc300c8c2', 'authenticated', 'authenticated', 'sol@fanzup.test', extensions.crypt('FanzupDev123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Sol Amara"}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('f147ba23-d0a1-562d-9140-267bc300c8c2', 'f147ba23-d0a1-562d-9140-267bc300c8c2', 'f147ba23-d0a1-562d-9140-267bc300c8c2', '{"sub":"f147ba23-d0a1-562d-9140-267bc300c8c2","email":"sol@fanzup.test"}', 'email', now(), now(), now());
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '1455d378-8b48-5019-a0dd-7c5295930861', 'authenticated', 'authenticated', 'velvet@fanzup.test', extensions.crypt('FanzupDev123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Velvet Circuit"}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('1455d378-8b48-5019-a0dd-7c5295930861', '1455d378-8b48-5019-a0dd-7c5295930861', '1455d378-8b48-5019-a0dd-7c5295930861', '{"sub":"1455d378-8b48-5019-a0dd-7c5295930861","email":"velvet@fanzup.test"}', 'email', now(), now(), now());
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'daba7ea1-c397-554c-87d4-ab17c5c4669e', 'authenticated', 'authenticated', 'fan@fanzup.test', extensions.crypt('FanzupDev123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Jordan Pierce"}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('daba7ea1-c397-554c-87d4-ab17c5c4669e', 'daba7ea1-c397-554c-87d4-ab17c5c4669e', 'daba7ea1-c397-554c-87d4-ab17c5c4669e', '{"sub":"daba7ea1-c397-554c-87d4-ab17c5c4669e","email":"fan@fanzup.test"}', 'email', now(), now(), now());
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'b40e0a39-c7ef-5798-91f3-504e09b530f4', 'authenticated', 'authenticated', 'reviewer@fanzup.test', extensions.crypt('FanzupDev123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"FanZuP Reviewer"}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('b40e0a39-c7ef-5798-91f3-504e09b530f4', 'b40e0a39-c7ef-5798-91f3-504e09b530f4', 'b40e0a39-c7ef-5798-91f3-504e09b530f4', '{"sub":"b40e0a39-c7ef-5798-91f3-504e09b530f4","email":"reviewer@fanzup.test"}', 'email', now(), now(), now());

update public.profiles set handle = 'jordanp', city = 'Little Rock, AR' where id = 'daba7ea1-c397-554c-87d4-ab17c5c4669e';
insert into public.staff (user_id, role) values ('b40e0a39-c7ef-5798-91f3-504e09b530f4', 'reviewer');

insert into public.artists (id, owner_id, slug, name, genre, city, tier, identity_status, phone_verified, monthly_listeners, streaming_history_months, ein_verified) values
  ('c36385da-a6c6-532b-a362-360bfbe4b9f7', '7219e6d0-7ffb-51d4-b758-fa8d97b279f4', 'nova-reyes', 'Nova Reyes', 'Alt R&B', 'Atlanta, GA', 'Rising', 'verified', true, 48200, 9, true),
  ('0196dd9e-c352-51ef-8660-7014c5e5ecff', '062523d9-b8c6-5b22-b3a4-b0114d619137', 'the-low-ends', 'The Low Ends', 'Indie Rock', 'Philadelphia, PA', 'Starter', 'verified', true, 9100, 6, false),
  ('8b5216b0-9616-5f1c-8013-6c409baebb52', 'f147ba23-d0a1-562d-9140-267bc300c8c2', 'sol-amara', 'Sol Amara', 'Afrobeats', 'Little Rock, AR', 'Rising', 'verified', true, 31800, 7, true),
  ('4640e639-ea55-507e-b76d-1665950cebc4', '1455d378-8b48-5019-a0dd-7c5295930861', 'velvet-circuit', 'Velvet Circuit', 'Electronic', 'Detroit, MI', 'Rising', 'verified', true, 67300, 14, true);

insert into public.campaigns (id, artist_id, slug, title, type, blurb, goal_minor, status, milestone_release, duration_days, starts_at, ends_at, tier_at_submission, cap_minor_at_submission) values
  ('ec7b0895-db3e-52a7-8e7e-56ef4dbfa145', 'c36385da-a6c6-532b-a362-360bfbe4b9f7', 'nova-live-band-tour', 'Take the band on the road', 'Tour', 'Fund a 12-city run with the full horn section — not backing tracks.', 2500000, 'live', true, 60, now() - interval '20 days', now() + interval '42 days', (select tier from public.artists where slug='nova-reyes'), (select campaign_cap_minor from public.tier_limits where tier = (select tier from public.artists where slug='nova-reyes'))),
  ('dbe19d49-d0c5-54da-b4bf-0ff0c03d5e27', '8b5216b0-9616-5f1c-8013-6c409baebb52', 'sol-amara-first-headline', 'My first headline show', 'Show', 'Fund My Show: a hometown headline night with a 9-piece band.', 600000, 'live', false, 60, now() - interval '20 days', now() + interval '58 days', (select tier from public.artists where slug='sol-amara'), (select campaign_cap_minor from public.tier_limits where tier = (select tier from public.artists where slug='sol-amara'))),
  ('1e7625f2-4279-5070-9b54-c7539ac818a1', '4640e639-ea55-507e-b76d-1665950cebc4', 'velvet-circuit-video', '"Night Shift" music video', 'Music Video', 'A one-take warehouse video shot on 16mm.', 1200000, 'live', false, 60, now() - interval '20 days', now() + interval '63 days', (select tier from public.artists where slug='velvet-circuit'), (select campaign_cap_minor from public.tier_limits where tier = (select tier from public.artists where slug='velvet-circuit'))),
  ('a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e', '0196dd9e-c352-51ef-8660-7014c5e5ecff', 'low-ends-debut-lp', 'Press our debut LP to vinyl', 'Album', 'Ten songs, recorded live to tape. Help us press the first 500.', 800000, 'live', false, 60, now() - interval '20 days', now() + interval '6 days', (select tier from public.artists where slug='the-low-ends'), (select campaign_cap_minor from public.tier_limits where tier = (select tier from public.artists where slug='the-low-ends')));

insert into public.campaign_tranches (campaign_id, seq, pct, milestone, evidence_required, target_date) values
  ('ec7b0895-db3e-52a7-8e7e-56ef4dbfa145', 1, 50, null, null, null),
  ('ec7b0895-db3e-52a7-8e7e-56ef4dbfa145', 2, 50, 'Tour starts — first show played', 'Venue settlement sheet', '2027-02-14');
select public.ensure_single_tranche(id) from public.campaigns where not milestone_release;

insert into public.perks (id, campaign_id, title, kind, price_minor, quantity_limit, fulfill_by, ships_to, sort) values
  ('47db82e3-deff-5150-8234-7b4d94f0cc7e', 'ec7b0895-db3e-52a7-8e7e-56ef4dbfa145', 'Digital thank-you + tour diary', 'digital', 1000, null, '2026-12-01', null, 0),
  ('17d7dddb-1ae3-5faf-b585-f3caeac70477', 'ec7b0895-db3e-52a7-8e7e-56ef4dbfa145', 'Signed tour poster', 'physical', 4000, 300, '2027-01-31', 'us', 1),
  ('75ce90f1-b040-59ba-b134-e2c350d59a68', 'ec7b0895-db3e-52a7-8e7e-56ef4dbfa145', 'Two tickets + soundcheck', 'experience', 15000, 60, '2027-03-31', null, 2),
  ('19b6ce8b-c3e7-5b5c-92c3-389cb745478b', 'ec7b0895-db3e-52a7-8e7e-56ef4dbfa145', 'Name in the tour credits', 'digital', 2500, null, '2027-02-28', null, 3),
  ('3835231c-7f19-5da7-88f7-02e8a3f255b6', 'dbe19d49-d0c5-54da-b4bf-0ff0c03d5e27', 'General admission', 'experience', 3000, 400, '2027-01-23', null, 0),
  ('5594d6d9-acac-5000-b762-460a6130d60e', 'dbe19d49-d0c5-54da-b4bf-0ff0c03d5e27', 'Meet & greet', 'experience', 9000, 40, '2027-01-23', null, 1),
  ('4fdbbe9d-386c-5c57-897f-5683787ffd53', '1e7625f2-4279-5070-9b54-c7539ac818a1', 'Early premiere access', 'digital', 800, null, '2027-02-28', null, 0),
  ('f40d629b-6dac-5cd6-81ff-3b16a74e08ac', '1e7625f2-4279-5070-9b54-c7539ac818a1', 'Be an extra', 'experience', 12000, 25, '2027-01-31', null, 1),
  ('378df26e-40c3-5fb4-8e8d-bea06ef84257', 'a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e', 'Digital album', 'digital', 1200, null, '2027-03-31', null, 0),
  ('b6658093-c8cb-5edd-b884-e7f4b3f55fb8', 'a60cb7d4-c5ca-571d-863b-ba8f7d1dc60e', 'Vinyl + digital', 'physical', 3500, 500, '2027-04-30', 'us', 1);
