# FanZuP Privacy Notice

> **DRAFT FOR ATTORNEY REVIEW — NOT LEGAL ADVICE — NOT FOR PUBLICATION.** First draft, 2026-11-27. No privacy notice has been published yet (`Legal.tsx` is a placeholder), so this is a full notice rather than an amendment. **Section 6 is the services-marketplace update** requested for CR-005; if an earlier notice is published before the marketplace flag turns on, section 6 can be issued as a standalone amendment with the change summary at the end. Vendor names are taken from the specs and must be confirmed against signed contracts. *(Open question P-1: which state laws apply. This draft offers the main state-law rights to all U.S. users, which is simpler to operate; attorney to confirm.)*

**Version:** [2026-xx-xx] · **Effective:** [date]

FanZuP LLC ("FanZuP", "we", "us") runs a platform where independent musicians raise money from fans for shows, tours, records and videos, and where artists can find service providers. This notice explains what personal information we collect through our website, web app and iOS and Android apps (the "Services"), how we use and share it, and the choices you have.

FanZuP is for adults. **You must be 18 or older to create an account**, and we don't knowingly collect information from children under 13 (or anyone under 18 as an account holder).

## 1. Information we collect

### 1.1 Information you give us
| Category | Examples | When |
|---|---|---|
| Account | Email, password (stored by our authentication provider as a hash), display name, 18+ confirmation and when you gave it | Sign-up |
| Profile | City, profile photo, bio; whether your profile is public (fan profiles are private by default) | When you choose to add them |
| Backings | Perks chosen, amounts, extra amount, dates, backing status, refund details | When you back a campaign |
| Shipping | Name and shipping address, only for physical perks, collected after a campaign is funded | Backer survey |
| Payment | Card or wallet details are entered into our payment processor's form and held by the processor. We receive a token, card brand, last four digits and expiry, not the full card number. | Checkout |
| Artist and campaign | Artist profile, campaign story, use of funds, risks, perks, milestones, updates, evidence of milestones | When you run a campaign |
| Identity and payout (artists, and providers if paid bookings are added) | Legal name, date of birth, address, government ID and selfie, tax identification number and bank account for payouts. **These are collected in a hosted flow run by our payment or identity-verification partner; FanZuP stores only references and statuses (for example "verified"), not your documents.** | Before an artist can receive funds |
| Marketplace (see section 6) | Provider profile and listings; service requests, briefs, budgets, dates; responses and notes; contact emails shared on acceptance | When you use the services marketplace |
| Communications | Messages to support, problem reports, dispute evidence, survey answers | When you contact us or report a problem |
| Consents | Which version of each policy you accepted and when, with IP address and device information; marketing choices | Sign-up, checkout, and when a policy changes |

### 1.2 Information collected automatically
- **Device and log data:** IP address, browser or app version, device type and operating system, pages and screens viewed, referring link, time and date, and error reports.
- **Security and fraud signals:** sign-in events, failed attempts, second-factor use, checkout velocity and linked-account signals used to stop card testing and fake backings.
- **Referral source:** which shared link brought you to a campaign, so artists can see what worked.
- **Cookies and similar technologies:** see the [Cookie and Tracking Notice](08-cookie-notice.md). During the beta we use only cookies needed to run the Services.
- **Mobile:** if you enable notifications, a push token. We don't collect precise location or your contacts.

### 1.3 Information from others
- **Payment processor and custodian:** payment status, refunds, chargebacks and payout results. *(Brief Q2: name the processor/custodian once chosen.)*
- **Identity-verification, sanctions-screening and tax-information providers:** verification and screening results.
- **Artists and providers:** for example, a provider's response to your request, or an artist's note that a perk was delivered.

## 2. How we use information
| Purpose | Information used | Legal basis note (for counsel) |
|---|---|---|
| Create and secure your account; let you sign in on web and mobile | Account, device, security | Contract |
| Process backings, hold and release campaign funds through our payment partners, refund backers when a campaign doesn't reach its goal, and handle cancellations and disputes | Backings, payment, identity | Contract; legal obligation |
| Let artists deliver perks (only the fields a perk needs; shipping addresses only after funding) | Backings, shipping | Contract |
| Review campaigns and providers, verify milestones, and enforce our terms | Campaign, marketplace, communications | Legitimate interests |
| Verify artist identity, screen against sanctions lists, collect tax information and file information returns | Identity and payout | Legal obligation |
| Prevent fraud, abuse, card testing and security incidents | Security, device, backings | Legitimate interests; legal obligation |
| Send transactional messages (receipts, campaign funded or failed, refunds, milestone releases, request accepted) | Account, backings, marketplace | Contract |
| Send marketing (artist digests, follower notifications about campaigns you haven't backed, FanZuP news) **only with your choice to receive it** | Account, preferences | Consent / opt-out |
| Improve and fix the Services, measure the funnel and referral sources | Log, device, referral | Legitimate interests |
| Keep records required by law, accounting, audit and our money-handling partners | Backings, payment, audit | Legal obligation |

**Automated assistance for staff.** FanZuP staff use AI tools to help review campaigns and summarize operations. These tools are advisory: a person makes every decision about approving a campaign, releasing money or refunding a backing. The information sent to the AI tool is limited to campaign content and display names or handles, not your email, address, payment or identity information. *(Source: specs/agents NFR-AGT-02. Open question AGT-Q1: vendor retention and DPA terms. Attorney: confirm whether this needs disclosure under state automated-decision or profiling rules; FanZuP's position is that no decision with legal or similarly significant effect is made solely by automated means.)*

We don't sell your personal information for money, and we don't share it for cross-context behavioral advertising. *(Attorney: confirm this remains true if any analytics or ads pixel is added; FR-PRV-005 requires consent first.)*

## 3. How we share information
- **Artists you back:** your display name (unless you back privately — *confirm feature*), the perk you chose, and what the artist needs to deliver it (for physical perks, your name and shipping address after the campaign is funded; for ticket perks, a ticket code). Artists get your email only if you choose to hear from them directly. Artists may use your information **only to deliver that campaign's perks and to communicate about that campaign** (Artist Campaign Agreement §[x]).
- **Other users:** public profile fields you choose to show; your name on public backer lists if that feature is used and you opt in.
- **Marketplace counterparts:** see section 6.
- **Service providers who work for us under contract**, including: hosting and database ([Vercel], [Render], [Supabase]); payments and custody ([Stripe] and [custodian]); identity verification ([Persona or other]); sanctions screening and tax information ([vendors]); email delivery ([Postmark/Resend]); push notifications and app builds ([Expo]); error monitoring ([Sentry]); and AI model provider for staff tools ([Anthropic]). They may use information only to provide services to us.
- **Legal and safety:** when required by law, subpoena or court order; to respond to a lawful request from a regulator or law enforcement; to protect the rights, safety or property of FanZuP, users or the public; or to enforce our terms.
- **Business transfers:** in a merger, acquisition, financing, or sale of assets, subject to this notice.
- **With your direction or consent.**

## 4. How long we keep information
We keep information only as long as needed for the purposes above, then delete or de-identify it. Key periods (full schedule in [Account Deletion and Data Retention](10-account-deletion-and-retention.md)):
- **Shipping addresses:** deleted after the later of 90 days after delivery and 180 days after the perk's expected delivery date, which covers the card-dispute window.
- **Financial and audit records** (backings, refunds, payouts, ledger entries, policy acceptances): at least 7 years, as required for tax, accounting and our payment partners. After you delete your account these are kept linked only to a pseudonymous ID.
- **Account and profile:** until you delete your account, then removed or pseudonymized after a 14-day grace period.
- **Marketplace requests:** see section 6.5.

## 5. Your choices and rights
- **Access and export:** download a copy of your information (profile, backings, campaigns, messages, consents, notifications).
- **Correction:** edit most information in your account settings, or ask us.
- **Deletion:** delete your account from the web app or from the Account tab in the mobile app. Deletion can't finish while you have a live campaign, money in motion or an open case; we'll tell you what has to finish first and exactly what we must keep and why.
- **Marketing:** unsubscribe from any marketing email using its link, or in settings. We honor unsubscribes within 10 business days. Transactional messages can't be turned off while you have an account.
- **Browser privacy signals:** we treat a Global Privacy Control (GPC) signal as an opt-out of any sale or sharing.
- **Push notifications:** turn them off in your device settings.
- **State privacy rights.** Depending on where you live (for example Virginia, California, Colorado, Connecticut and other states), you may have the right to know, access, correct, delete and port your information, to opt out of sale, sharing, targeted advertising and certain profiling, and to appeal our decision on your request. We offer these rights to all U.S. users. We'll respond within 45 days (extendable where the law allows) and won't discriminate against you for using them. You can use an authorized agent where the law allows; we may ask you to verify your identity. To appeal a decision, reply to our response with "Appeal"; if we deny your appeal you can contact your state Attorney General. *(Attorney: P-1, confirm thresholds, add California "Notice at Collection" categories table and sensitive-information (government ID, account log-in, financial account) disclosures, and the right to limit use of sensitive information if applicable.)*

To make a request: [privacy@fanzup.com] or [in-app link]. 

## 6. Services marketplace *(new — CR-005)*
FanZuP's services marketplace lets artists find independent service providers (such as producers, mixing and mastering engineers, session players, songwriters, videographers, photographers, designers, marketing and PR, and tour support) and send them requests. **FanZuP doesn't process payments for marketplace services**; artists and providers agree terms and pay each other directly.

### 6.1 What we collect
- **From providers:** profile (display name, headline, bio, city, whether you work remotely, service categories, up to five portfolio links), listings (service, description, "starting at" price, typical turnaround), a contact email, your profile's review status and any staff notes, and your responses to requests.
- **From artists who send requests:** the listing you chose, your brief, an optional budget and needed-by date, an optional linked campaign, and your choice whether to share your account email with the provider if they accept.
- **About both:** request status changes (sent, accepted, declined, withdrawn, closed) and the time of each, and a security log of those changes that refers to you by ID only.

### 6.2 How it's used
To show the directory, send requests to providers, show each side the responses, review providers before they're listed (by FanZuP staff), keep the marketplace free of spam (for example, limiting each user to 10 new requests a day), enforce the Provider Terms and our Acceptable Use rules, and measure whether the marketplace is useful (for example, how many requests are sent and accepted).

### 6.3 Who sees what
| Information | Who can see it |
|---|---|
| A listed provider's profile, listings and portfolio links | Anyone, including people who aren't signed in |
| A provider's contact email | **Only** an artist whose request that provider accepted |
| A request's brief, budget, needed-by date, the artist's display name and the linked campaign's title | The provider it was sent to, the artist who sent it, and FanZuP staff |
| The artist's account email | **Only** the provider, **only** if the artist chose to share it **and** the provider accepted |
| Draft, in-review, changes-requested and suspended profiles; staff notes | The provider and FanZuP staff |

When a provider declines, nothing more is shared. Portfolio links open in your browser on the provider's chosen site, which has its own privacy practices.

### 6.4 What providers and artists may do with each other's information
A provider may use what they receive only to respond to that request and to provide and bill for the agreed services, and an artist may use a provider's contact details only to arrange that work (Provider Terms §8.2). Once you share contact details and work together outside FanZuP, **FanZuP doesn't control what the other party does**, and their own privacy practices apply.

### 6.5 How long we keep it
Marketplace requests and responses are kept for [2 years] after the request closes, then deleted or de-identified, unless we need them longer for a dispute, a legal claim or enforcement. Provider profiles are kept until the provider deletes them or their account. *(Attorney: confirm period; proposed default, not in the specs.)*

### 6.6 If paid bookings are added
If FanZuP later processes payments for marketplace services, we'll collect additional information (for example, provider identity, tax and payout details and sanctions-screening results) and will update this notice before that starts.

## 7. Security
We protect information with measures such as encryption in transit, encryption at rest for shipping addresses and other sensitive fields, access controls with second-factor sign-in for staff, separation of duties, audit logs, and keeping payment card data with our payment processor. No system is perfectly secure; if a breach affects your information we'll notify you as the law requires.

## 8. Where information is processed
FanZuP operates in the United States, and our database is hosted in the U.S. (East US, Virginia). The Services are intended for U.S. users. *(Attorney: if non-U.S. fans can back campaigns, add international transfer language and consider GDPR/UK GDPR applicability.)*

## 9. Children
The Services aren't directed to children and accounts are for adults 18+. If we learn an account belongs to someone under 18, we'll suspend it and delete information as the law requires. Contact us at [privacy@fanzup.com] if you believe a minor has an account.

## 10. Changes
We'll post any change here with a new version date. For material changes we'll notify you by email or in the app before they take effect and, where required, ask you to accept the new version.

## 11. Contact
FanZuP LLC, [physical address], Virginia · [privacy@fanzup.com]

---
### Change summary for the marketplace update (use if section 6 is issued as an amendment)
"We've launched a services marketplace in beta. We added section 6, which explains what providers and artists share when they use it: provider profiles are public once reviewed; a provider's contact email is shown only to an artist whose request they accept; an artist's email is shared only if the artist chooses and the provider accepts. FanZuP doesn't handle payments for these services."

**Sources:** `specs/01-requirements.md` FR-PRV-001…006, FR-ID-004/006, FR-TAX-001…003, FR-FUL-001/004, NFR-SEC-08, NFR-COMP-11/13/14; `specs/marketplace/01-requirements.md` FR-MKT-003…010, NFR-MKT-03/04; `specs/agents` NFR-AGT-02, AGT-Q1; `docs/SETUP.md` (vendors, region); `specs/mobile/01-requirements.md`.
