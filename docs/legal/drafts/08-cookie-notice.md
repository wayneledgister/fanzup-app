# FanZuP Cookie and Tracking Notice

> **DRAFT FOR ATTORNEY REVIEW — NOT LEGAL ADVICE — NOT FOR PUBLICATION.** First draft, 2026-11-27. Written for the beta, where FR-PRV-005 allows **no non-essential trackers at all**. The cookie table must be checked against what the production build actually sets (run a cookie scan on the production domain before publishing). If analytics or advertising tools are added, this notice, a consent banner and the Privacy Notice must change first.

**Version:** [2026-xx-xx] · **Effective:** [date]

This notice explains how FanZuP uses cookies and similar technologies (local storage, session storage, and device identifiers in the apps) on fanzup.com and in our apps.

## What we use today
**Only technologies needed to run the Services.** We don't use advertising cookies, cross-site tracking, or third-party analytics during the beta.

| Name / type | Set by | Purpose | Lasts |
|---|---|---|---|
| Authentication session (`sb-*` local storage / cookie) | FanZuP via [Supabase Auth] | Keeps you signed in and secures your session | Until you sign out or the session expires |
| Checkout state | FanZuP | Remembers the perk you chose while you sign up and pay | Session |
| Payment security cookies | [Stripe] (on checkout pages only) | Fraud prevention and secure card entry | Set by Stripe; see Stripe's cookie policy |
| Preferences (for example theme) | FanZuP | Remembers display choices | [1 year] |
| Referral source | FanZuP | Records which shared link brought you to a campaign, so the artist can see what worked | [30 days] *(attorney: confirm "strictly necessary" vs. analytics classification)* |
| Mobile: secure token storage, push token | FanZuP apps | Keeps you signed in; delivers notifications you enabled | Until sign-out or you turn notifications off |

## Your choices
- You can block or delete cookies in your browser, but signing in and checkout won't work without them.
- **Global Privacy Control:** we honor GPC as an opt-out of any sale or sharing of personal information.
- Push notifications can be turned off in your device settings.

## If this changes
Before we add any non-essential cookie (such as analytics or advertising), we'll update this notice and, where the law requires, ask for your consent first; non-essential tools won't load until you agree.

## Contact
[privacy@fanzup.com]

---
**Sources:** `specs/01-requirements.md` FR-PRV-005, FR-BCK-002 (choice survives sign-up), FR-GRO/ANL referral source; `specs/mobile/02-design.md` (secure storage).
