# FanZuP Account Deletion and Data Retention

> **DRAFT FOR ATTORNEY REVIEW — NOT LEGAL ADVICE — NOT FOR PUBLICATION.** First draft, 2026-11-27. **Part A** is a public page: Apple (App Review Guideline 5.1.1(v)) and Google Play (account-deletion policy, including a web link to request deletion) require apps that allow sign-up to let users start deletion in the app and to explain it. FR-MOB-009 blocks public store submission until FR-PRV-003 ships. **Part B** is the internal retention schedule NFR-COMP-13 requires "before the first real user's data is collected"; it isn't published as is. Periods marked *proposed* aren't in the specs and need counsel's confirmation.

**Version:** [2026-xx-xx] · **Effective:** [date]

---

## Part A — Deleting your FanZuP account (public)

### How to delete
- **In the app:** Account → Delete my account.
- **On the web:** Settings → Account → Delete my account, or go to [fanzup.com/account/delete].
- **By email:** [privacy@fanzup.com] from the address on your account.

### What happens
1. We show you exactly what will be deleted and what we have to keep, and why, before you confirm.
2. Your account is deactivated at once and you're signed out on all devices.
3. You have **14 days** to change your mind by signing in again.
4. After 14 days your personal information is deleted or replaced with a pseudonymous ID. We also ask our identity and tax partners to delete the information they hold for us, where the law lets them.

### When deletion has to wait
We can't finish deleting your account while:
- you have a live campaign, or a funded campaign with perks still to deliver or funds still to release;
- a backing, refund or payout of yours is still in progress; or
- you have an open problem report, dispute or chargeback.

We'll tell you what needs to finish first.

### What we keep, and why
| Kept | Why | How long |
|---|---|---|
| Records of backings, refunds, payouts and fees (amounts, dates, references), linked only to a pseudonymous ID | Tax, accounting and our payment partners' rules; to answer chargebacks and refund questions | At least 7 years |
| Security and audit logs (which refer to people by ID only) | Fraud prevention, security and legal obligations | At least 7 years |
| Which policy versions you accepted, and when | To show what you agreed to | 7 years *(proposed)* |
| Tax forms issued to you (artists) | IRS requirements | [4–7] years |
| Information we need for a legal claim, investigation or legal hold | Legal obligation | Until it's resolved |

Things you posted publicly (for example, a campaign page) are removed or, for a campaign that took backings, de-identified so backers keep a record of what they backed. *(Attorney: confirm treatment of a funded campaign page after the artist deletes their account.)*

### Download your data first
You can download a copy of your information from Settings → Privacy → Download my data. We'll prepare it within 45 days (usually much sooner).

---

## Part B — Retention schedule (internal)
Owner: [Wayne / data owner]. Reviewed: annually and at each new data class. Deletion pseudonymises PII and keeps financial and audit records under legal hold (NFR-COMP-13).

| Data class | Where | Retention | Then | Basis |
|---|---|---|---|---|
| Account (email, display name, auth identifiers) | Supabase Auth, profiles | Life of account + 14-day grace | Delete / pseudonymise | Contract; POLICY.account.deletionGraceDays |
| Fan profile fields (city, bio, photo) | profiles, storage | Life of account + 14 days | Delete | Contract |
| 18+ attestation and policy acceptances | consents | 7 years after account closure *(proposed)* | Delete | Legal claims |
| Backings, ledger entries, refunds, payouts | ledger_* (append-only) | ≥ 7 years | Keep pseudonymised; archive | Tax, accounting, partner requirements; NFR-COMP-12 |
| Audit events | audit tables + object-locked daily export | ≥ 7 years | Archive | NFR-COMP-11/12 |
| Shipping addresses | encrypted fields | Later of delivery + 90 days and expected delivery + 180 days | Purge | NFR-SEC-08, retention.addressDays |
| Ticket codes | tickets | Event date + [90] days *(proposed)* | Delete | Contract |
| Identity verification | Partner-held; FanZuP stores references and status only | Partner's schedule; references 7 years | Request partner deletion where permitted | FR-ID-004, FR-PRV-003 |
| Tax information (TIN), information returns | Tax/TIN vendor; references in FanZuP | [7] years | Per vendor | IRS rules; Brief Q7 |
| Sanctions screening results | Screening vendor; status in FanZuP | 5 years after relationship ends *(proposed)* | Delete | OFAC recordkeeping (31 CFR 501.601) |
| Campaign content and milestone evidence | campaigns, storage | Life of campaign + 7 years for funded campaigns *(proposed)* | De-identify | Disputes, audit |
| Support tickets, problem reports, dispute evidence | support system, cases | 3 years after closure *(proposed)*, or longer under legal hold | Delete | Claims |
| Marketplace provider profiles and listings | service_providers, service_listings | Until provider deletes, + 14 days | Delete | Contract |
| Marketplace requests, responses, contact-share flags | service_requests | 2 years after request closes *(proposed)* | Delete / de-identify | Abuse prevention; E1 measurement |
| Notification log (template version, sent time) | notifications | 2 years *(proposed)* | Delete | Proof of notice |
| Push tokens | devices | Until sign-out or token invalid | Delete | Contract |
| Server and error logs | Vercel, Render, [Sentry] | 30–90 days *(proposed)* | Auto-expire | Security |
| AI agent inputs and outputs (no PII beyond display names) | agent_* tables; model vendor | [1 year] in FanZuP *(proposed)*; vendor per AGT-Q1 | Delete | Audit of staff decisions |
| Backups | Supabase PITR | [7–30] days rolling | Expire | Resilience |
| Data-subject request case records | cases | 3 years *(proposed)* | Delete | Proof of compliance |
| Unclaimed refunds | ledger | Per FR-PAY-011 / state unclaimed-property law | Escheat | Counsel |

**Process rules**
1. Deletion requests and access requests are tracked as cases and answered within 45 days (NFR-COMP-14), including vendor-held data.
2. Deletion is blocked while a live campaign, open money movement or open case exists, and the UI says what must finish first (FR-PRV-003).
3. Legal holds override the schedule; a hold is recorded with reason, owner and review date.
4. Backups aren't edited; deleted data ages out with the backup window and isn't restored to production.

---
**Sources:** `specs/01-requirements.md` FR-PRV-002/003, NFR-SEC-08, NFR-COMP-11…14, FR-ID-004, FR-PAY-011; `specs/mobile/01-requirements.md` FR-MOB-009; `packages/shared/src/policy.ts` (`account.deletionGraceDays`); `specs/marketplace/01-requirements.md`.
