# Runbook: services marketplace closed beta
**Owner:** Wayne (operator) · **Status:** active · **Date:** 2026-11-27 · **Implements:** CR-007 (FR-MKT-021…029), ADR-012 · **Money:** none (ADR-010)

How to open, run, widen and close the services-marketplace beta. Every staff step below is a privileged action: it needs a staff session with your authenticator code (aal2) and a typed reason of at least 10 characters, and it lands in the audit log and your weekly review.

## 0. Before the beta can open (one time)
| Step | Who | Done when |
|---|---|---|
| Counsel approves the Provider Terms (`docs/legal/drafts/05-provider-terms.md`) and the privacy-notice marketplace section (§6) | Wayne + counsel | written approval on file |
| PR: publish both texts on `/legal/provider-terms` and `/legal/privacy`, set `POLICY.legal.providerTerms = { version: "<date>", approved: true }`, `privacyCoversMarketplace: true`, and bump `privacyVersion` (everyone re-accepts at next sign-in) | engineering | PR merged, CI green |
| Turn the marketplace on: `POST /api/v1/staff/flags/marketplace {"on": true, "reason": "…"}` from a staff session with your authenticator code (there's no flags screen yet) | Wayne | answers 200 (in a deployed environment it answers 409 `legal_not_ready` until the PR above ships) |

The audience starts as **Invited people only** (Wayne's decision D-MKT-3, 2026-11-27). Nobody sees Services until they redeem an invite.

## 1. Invite providers and artists
1. Open **Staff → Marketplace beta** (`/admin/marketplace`).
2. Fill in the person's email (they must sign in with this exact address), choose **Provider** or **Artist**, add a name and a note for yourself, type a reason, and press **Create invite**.
3. Copy the link that appears. **It's shown once**: FanZuP stores only a hash. Send it yourself (email, text, DM). FanZuP doesn't send email yet.
4. The invite works once and expires after 30 days (`POLICY.marketplace.inviteDays`). If someone loses theirs, revoke it and create a new one.

What the invitee sees: the link asks them to sign in (or create an account with the invited email), then says "You're in". Providers go straight to their profile, accept the Provider Terms, fill in their profile and services and submit for review. Artists go to Browse services.

Common problems:
| They see | Cause | Fix |
|---|---|---|
| "This invite is for a different account" | signed in with another email | sign out; sign in or sign up with the invited address, or revoke and re-invite their real address |
| "This invite link doesn't work any more" | used, revoked or expired, or the link was cut off | create a new invite |
| "Provider profiles are invite-only for now" | they joined with an **artist** invite | send a **provider** invite to the same email; it upgrades them |

## 2. Vet providers
**Staff → Service providers** (`/admin/providers`). Check the portfolio links are real and the provider's own work, then **List provider**, **Request changes** (with a note) or **Suspend**. You can't vet your own profile. A listed provider who edits their headline, bio, categories, links or services goes back to review automatically.

## 3. Watch the beta (discovery E1/E2)
The numbers at the top of `/admin/marketplace`: providers listed and in review, members, requests in the last 7 and 30 days, acceptance rate and median time to answer. Counts only, no personal data. Review weekly with the single-operator log.

## 4. Remove someone
`/admin/marketplace` → Members → **Remove…**. Their access ends at once; their profile and requests stay. If they're a listed provider, also **Suspend** them on the vetting page (that declines their open requests with "This provider is no longer listed.").

## 5. Widen or close
- **Invited providers, any signed-in artist** (`open_requests`): anyone signed in can browse and send requests; listing still needs a provider invite.
- **Everyone**: anyone can browse; anyone signed in can request or apply as a provider (still vetted).
- Change it in `/admin/marketplace` → "Who can use the marketplace". To go back, choose **Invited people only**.
- **Close everything:** turn `flag.marketplace` off. Every marketplace route answers 404 at once; data stays. Turning it off is never blocked.

## 6. Rollback
Code: revert the CR-007 PR; the migration `20261128000100_marketplace_beta.sql` only adds tables, a setting and a consent kind, so leaving it in place is safe. Operationally: flag off (section 5).
