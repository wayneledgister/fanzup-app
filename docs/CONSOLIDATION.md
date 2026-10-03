# FanZuP — Mockup Consolidation Map

**Status:** v1.0 · 2026-10-02 · Owner: Wayne · Source of truth for the first implementation pass.

## Rule of precedence

When a mockup and the FanzUp doc set disagree, **the docs win**. Order:

1. `branding and design guidelines/BRAND_GUIDELINES.md` v2.0 + `DESIGN_SYSTEM.md` v2.0 (look, voice, naming, §7.4 regulated language)
2. `Regulatory/Mechanisms/*` (esp. 05 Reward Escrow = first build, 07 Secondary Market)
3. `PRDs/FanZuP_PRD_01_Platform.md` (+ 01a/01b), `PRD_02` (discovery), `PRD_03` (trust & safety)
4. `products/*.html` (fees, tiers, regulatory catalog)
5. The three Figma Make files, in this order: **Fan Profile Setup** (structure) → **FanZuP** (feature source) → **FanZuP-Draft** (retired; only SecondaryMarket was read)

## Sources

| Make file | Key | Role in the consolidated app |
|---|---|---|
| Fan Profile Setup Mock-up | `aVMPnRxVWDrO2RjpZA6ku1` | **Foundation.** Routing, page structure, onboarding/KYC/campaign/investment/compliance flows. Its bundled `DESIGN_SYSTEM.md` is the **retired v1.0 purple system** — layout kept, styling replaced. |
| FanZuP | `jxvbRsFZIGnKnbJs3s3S1E` | **Feature source.** Single-page state-machine demo; selected features rebuilt as routed pages. Cosmic lime/purple styling and crypto/yield copy discarded. |
| FanZuP-Draft | `sntmrBPxFiCQKVBDP6F0aB` | **Retired.** Superseded by FanZuP. |

## Global changes applied to every screen

- **Visual system → Brand v2.0:** `#0B0B0D` canvas, `#17181C` cards, gold `#D4AF37` for CTAs/focus only (~10% of a screen), black text on gold (never white), Space Grotesk headings, Inter body, JetBrains Mono tabular figures for every amount/count/ID. Lucide icons at 2px stroke. 4px grid; radius 6/8/12/16.
- **Naming (Brand §7.5):** FanZuP (exact casing); Pools (Brand / Creator / Project), Units, Wallet, Waterfall; creator Tiers = **Starter / Rising / Established / Pro**; All-Access.
- **Banned copy (Brand §7.4, PRD 01 §11, Legal Dynamics):** yield, APY, staking/stake, guaranteed, "earn returns", liquidity/tradeable claims, on-chain/multisig/ETH/USDC/0x addresses, "SEC Compliant" badges, invented partners (e.g. "Apex Clearing", "FDIC pass-through"), leaderboards/rankings by money invested. Returns are always "potential" and paired with risk of loss.
- **Two layers, gated in code:** Layer 1 (no securities, no fan KYC) ships first. Layer 2 (Reg CF securities) screens are built but behind the `layer2` feature flag. Post-Beta screens sit behind `postBeta`.
- **Fan money custody:** FanZuP never holds balances (Concerns #5). Wallet UI shows payment methods + funds "held by our escrow partner"; no stored balance, virtual card, cashback or auto-sweep.

## Screen inventory

Legend — **Keep**: port from Fan Profile Setup, reskin. **Build**: placeholder in mockups, build to the AC notes. **Rebuild**: concept from FanZuP, rebuilt to doc rules. **Gate**: built, hidden behind a flag. **Drop**: not ported.

### Public & auth
| Route | Source | Action | Notes |
|---|---|---|---|
| `/` landing | FPS `LandingPage` | Keep | Hero copy → Brand §1.8 / §9 ("FUND THE CULTURE." white / "OWN THE FUTURE." gold). Stats row marked placeholder until live figures (Brand §10). |
| `/signup`, `/verify-email`, `/login`, password reset, auth errors | FPS `SignUpFlows`, `EmailVerification`, `LoginAndPasswordFlow`, `AuthErrorStates` | Keep | MFA step per PRD 01 FR-IDENTITY. |
| How it works / Discover / Trust sections | FanZuP `HowItWorks`, `Discover`, `Trust` | Drop | Landing page from FPS already covers these; reuse only escrow/refund messaging. |

### Fan onboarding (Layer 1)
| Route | Source | Action | Notes |
|---|---|---|---|
| `/onboarding/account` | FPS stub | Build | Email, password, DOB age-gate, terms consent. |
| `/onboarding/path` | FPS `StepPathChoice` | Keep | Supporter (no KYC) vs Investor (KYC) — investor path gated by `layer2`. |
| `/onboarding/profile`, `/onboarding/discover` | FPS | Keep | |
| `/onboarding/payment` | FPS `PaymentSetup` | Keep | Payment methods only; no stored balance. |
| `/onboarding/complete` | FPS stub | Build | Confirmation + "Go to your feed". |

### Investor verification (Layer 2 — `layer2`)
| Route | Source | Action | Notes |
|---|---|---|---|
| `/onboarding/kyc-handoff`, `/onboarding/kyc/*`, `/onboarding/kyc-pending`, `/kyc/{pending,approved,rejected}` | FPS | Keep · Gate | KYC SDK reference screens; vendor-hosted in production (PRD 01 §9.7). |
| `/investor/certification` | FPS `InvestorCertification` | Keep · Gate | Income/net-worth attestation for Reg CF limits (PRD 01 §15 Q3). |

### Artist onboarding & tiers
| Route | Source | Action | Notes |
|---|---|---|---|
| `/artist-onboarding/*` (basic → media → social → streaming → review → KYC → outcomes → tier1-unlock → complete) | FPS | Keep | Tier gates per PRD 01 §6.3 (Starter $10K: KYC, email+phone, 100% profile, 1 released track). |
| `/tier2/*` | FPS | Keep · Gate | Rising: EIN/LLC, ≥1k listeners, 90d history. Unlocks Layer 2 only. |
| Creator verification flow | FanZuP `CreatorVerificationFlow`, `VerificationFlow` | Drop | Duplicates FPS artist onboarding. |

### Campaigns & Pools
| Route | Source | Action | Notes |
|---|---|---|---|
| `/campaign/{basics,details,perks,preview,success,live}` | FPS | Keep | **First build = reward campaign ("Fund My Show", Mechanism 05):** perks only, target-or-refund escrow, optional milestone release. No share of proceeds anywhere in this flow. |
| Revenue-share Pool creation (deal terms, units, return cap, maturity) | FanZuP `CreatorApp` create-pool modal step 2–3 | Rebuild · Gate | Separate `layer2` path off the same wizard; Form C review step; interception mechanism required (PRD 01 §6.5). |
| AI compliance assistant / visual asset auditor / legal doc generator / reward contract simulator / licensing vault | FanZuP | Drop | Not in any PRD. Revisit via sdd-change if wanted. |
| `/campaign-detail` | FPS `CampaignDetailPage` | Keep | Escrow + auto-refund disclosure visible (Brand §7.3). Layer 2 detail adds illiquidity / principal-at-risk / unsecured-claim block (PRD 01 §11). |

### Marketplace & discovery
| Route | Source | Action | Notes |
|---|---|---|---|
| `/` home feed, `/explore`, search overlay, creator card, empty/error states | FPS marketplace + search | Keep | Ranking must not sort by return; ineligible offerings never shown as backable (PRD 02 §8). |
| `/artist/:id` public profile | FPS `PublicCreatorProfile` (stub route `/artist/:id`) | Keep | Tabs Posts / Music / Merch / Events. |
| Brand Pool marketplace, US/Global activity maps, yield leaderboard, global yield index, recent stakers ticker | FanZuP | Drop | Money-ranked or yield-framed; conflicts with PRD 02 §8 and Brand §7.4. |

### Investment (Layer 2 — `layer2`)
| Route | Source | Action | Notes |
|---|---|---|---|
| `/investment/documents`, `/investment/confirmation` | FPS | Keep · Gate | Transactional Reg CF limit check, risk acknowledgment, Form C link, state eligibility. |
| Holdings / portfolio | FanZuP `FanApp` dashboard | Rebuild · Gate | "Your Pools": units held, amount backed, distributions received, return-cap progress, maturity, lock-up end date. No "accrued yield", no ranking. |

### Creator dashboard
| Route | Source | Action | Notes |
|---|---|---|---|
| `/creator/*` dashboard, revenue analytics, content mgmt, events, upload | FPS creator-dashboard | Keep | |
| Revenue source connections | FanZuP `IntegrationsPanel` | Rebuild · Gate | Per PRD 01b connection states (PENDING/ACTIVE/STALE/REVOKED/ERROR). |
| Unit distribution health, resource path visualizer, social synthesis hub, forecasting, milestone tracker, achievement system | FanZuP | Drop | Not specified in PRDs. Milestones live inside the campaign (Mechanism 05 §2.4). |

### Live streaming (Layer 1)
| `/streaming/*` | FPS | Keep | Pay-per-view per PRD 01 §6.1. |

### Selected FanZuP features (Wayne, 2026-10-02)
| Route | Source | Action | Doc basis / changes |
|---|---|---|---|
| `/settings/payments` (Wallet) | FanZuP `BankingSystem` + FPS `PaymentSetup` | Rebuild | Payment methods + backing history + payout account (creators). Funds shown as held by escrow partner. **Dropped:** stored balance, auto-sweep, virtual card, cashback, "yield-to-spend", custody/FDIC claims. |
| `/fees` | FanZuP `PlatformFeeTransparency` | Rebuild | Numbers come from `products/fees.html`, **not** the mockup's $99 / 2.5% / 1.5% / $10. Drop USDC/cold-storage/smart-contract copy. |
| `/settings/tax` (Tax documents) | FanZuP `TaxCenter` / `TaxPortal` | Rebuild | Layer 1: artists get 1099-NEC (Mechanism 05 §4); fans backing reward campaigns get **no** tax forms. Layer 2 (`layer2`): fan 1099s with cost basis (PRD 01 §11.1, Mechanism 04). Drop "harvest" concept. |
| `/tickets` | FanZuP `TicketMarketplace` | Rebuild | Primary ticket sales for artist events. Perk/discount for **backers and subscribers**, never for holding units (avoids tying securities to consumer perks). |
| `/merch` | FanZuP `MerchBag` | Rebuild | Artist merch store + "My perks" vault for campaign rewards (codes, downloads, shipping status). Drop "Genesis" / "Protocol" language. |
| `/backstage` | FanZuP `BackstagePassGallery`/`Claim`/`Content` | Rebuild | Exclusive content unlocked by subscription or campaign perk. Not unlocked by units held. |
| Fan badges / All-Access | FanZuP `FanLoyaltyBadges`, `FanTierRewards` | Rebuild | Engagement badges (backed N campaigns, subscriber streak, shows attended) + All-Access card (Brand §6.2/§9). **Dropped:** Star/Nebula/Galaxy/Supernova dollar-invested tiers, "stake more to unlock", NFT collectible, priority payouts. |
| `/secondary` | FanZuP-Draft `SecondaryMarket` | Rebuild · Gate (`layer2`) | **Beta = P0:** per-holding lock-up countdown + illiquidity disclosure. **`postBeta`:** P1 soft-transfer request (issuer / accredited / family only, no price) per Mechanism 07. No order book, prices, volume, liquidity vault or ETH. |
| `/governance` | FanZuP `GovernancePortal` | Gate (`postBeta`) | No PRD defines governance. Only basis: SPV pass-through voting rights (Mechanism 03). Stub page "Holder communications & votes" for SPV-structured Pools; no on-chain, delegation, slashing or tier-weighted voting. **Open question for Wayne.** |

### Admin / compliance
| `/compliance/*` | FPS | Keep | Under review / revisions / approved queues. Add KYC queue + Form C review per PRD 01 FR-ADMIN as stubs. |
| Legal admin dashboard, compliance center, infringement portal, trademark guide | FanZuP | Drop for now | Admin tooling beyond FPS queues isn't specced yet. |

### Internal design-system pages
| `/ds/*` components, icons, layout grid, docs | FPS showcase pages | Keep | Regenerated from v2.0 tokens; used as the in-app style reference. |

### Dropped outright (FanZuP)
Supernova executive lounge, cosmic profile, stakeholder chat / network chat overlay, investor alerts toasts, localized guide alerts, QuickStart player, media net, mobile prototype/site (responsive build replaces it), official purpose, smart-contract visualizer/audits, Supabase demo backend.

## Open questions (decisions for Wayne)

1. **Governance:** kept as gated (`postBeta`) "Holder communications & votes" for SPV-structured Pools only. Keep, or drop from scope? No PRD covers it.
2. **Fan engagement:** badges count engagement (backed campaigns, subscriber streaks, shows attended), not dollars. The All-Access card is a profile artifact, not a payment card. OK?
3. **Fees:** platform fee rates show "Being finalized" per `products/fees.html`; only Stripe 2.9% + $0.30 is shown. Who absorbs card processing on fan checkout: artist (current copy, per fees.html) or fan?
4. **Landing stats:** removed until verified live figures exist (Brand §10).
5. **Established / Pro criteria:** docs only give caps; UI says "criteria published before this tier opens". The creator dashboard's "Path to Established" uses placeholder targets.
6. **Fan Reg CF tax form:** layer2 tax section labels 1099-MISC; confirm against Mechanism 04 (C-corp issuer → 1099-DIV?).

## Placeholder values to confirm (invented for the prototype)

| Where | Value |
|---|---|
| Campaign wizard | Campaign length 7–60 days; goal-guidance formula; perk price ranges; review SLA "usually within 2 business days" |
| Campaign live / dashboard | 40/35/25% milestone release split |
| Admin queues | SLA targets 2 / 1 / 3 / 1 business days |
| Fan app | $6 flat merch shipping; 6-ticket order limit; $500 tip cap per stream; 48-hour stream replay; 14-day account-deletion grace |
| Artist profile | $5/month subscription price |
| Investor | Demo fan's $5,000 Reg CF limit (illustrative, not a regulatory figure) |
| Support | support@fanzup.example address |

## Not yet wired (prototype only)
Uploads, phone/OTP, ID capture, EIN checks, payment processor, streaming connections, video player, document downloads, and all persistence are simulated with in-memory demo data (`src/lib/mock.ts` + per-area `data.ts`). Terms and Privacy pages say "being finalized with counsel" rather than showing placeholder legal text.
