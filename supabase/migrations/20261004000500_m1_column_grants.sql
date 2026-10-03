-- M1 · column allowlists (NFR-SEC-01 slice, FR-PRV-004 direction). Design 02 §3.8.
-- Clients may read only these columns; identity/payout references, verification flags and private profile
-- fields are readable only through the API (service role) for the owner or staff. A test asserts the exact sets.

revoke select on public.artists from anon, authenticated;
grant select (id, owner_id, slug, name, genre, city, bio, tier, identity_status, created_at) on public.artists to anon, authenticated;

revoke select on public.profiles from anon, authenticated;
grant select (id, handle, display_name, bio, created_at) on public.profiles to anon, authenticated;
