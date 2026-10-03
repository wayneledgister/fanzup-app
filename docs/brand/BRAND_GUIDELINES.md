# FanZuP — Brand Guidelines

**Version 2.0 · June 2026 · Confidential**
*Fund the culture. Own the future.*

This document is the single source of truth for the FanZuP brand. It supersedes the v1.0 purple/blue design system (now retired). All product, marketing, and partnership materials should derive from the tokens and rules defined here.

---

## 0. How to use this document

- **Designers** — work from §3 Color, §4 Typography, §2 Logo, and §8 Components. Tokens map 1:1 to `DESIGN_SYSTEM.md`.
- **Engineers** — use the CSS custom properties in §3.6 and `DESIGN_SYSTEM.md`. Never hard-code hex values.
- **Marketing / partnerships** — work from §1 Foundation, §6 Imagery, §7 Voice & Tone, and §9 Applications.
- **Compliance** — see §7.4 (regulated-language rules) before publishing any investment-facing copy.

---

## 1. Brand Foundation

### 1.1 What FanZuP is
FanZuP is a **regulated fan-investment platform for independent music artists**. It combines fan subscriptions, equity crowdfunding, and automated revenue-sharing in a single SEC Reg CF–compliant infrastructure. Fans move from passive consumers to active stakeholders; artists access capital from their own fanbase without surrendering creative control to a label.

> **Category line:** *Kickstarter meets equity crowdfunding, built natively for music.*

### 1.2 Mission
Give independent artists the infrastructure to fund their careers on their own terms — and give the fans who believe in them a real stake in the outcome.

### 1.3 Vision
A music economy where the people who create the culture, and the people who power it, share in the value they build together.

### 1.4 Positioning statement
> For **independent artists** who need capital without giving up ownership, and the **fans** who want more than a like — FanZuP is the **regulated funding platform** that turns belief into ownership and revenue into shared reward. Unlike labels, Patreon, or Kickstarter, FanZuP combines investment, revenue-share, community, and real-time analytics in one music-native, compliant product.

### 1.5 Brand personality
**BOLD · TRUSTED · EMPOWERING — where finance meets culture.**

| Trait | What it means | How it shows up |
|---|---|---|
| **Bold** | Confident, ambitious, culture-forward. We make big claims and back them. | Heavy display type, high-contrast black & gold, decisive CTAs. |
| **Trusted** | Regulated, transparent, secure. Money is involved — we never feel reckless. | Clear numbers, plain disclosures, restrained UI, escrow/compliance cues. |
| **Empowering** | We hand power to artists and fans, not gatekeepers. | "Own," "your," "share" language; progress, milestones, tiers. |

**Voice keywords:** Transparent · Secure · Compliant · Empowering · Built for the Culture.

### 1.6 Brand values
1. **Ownership** — We believe artists should keep their work and fans should share in it.
2. **Transparency** — Radical clarity on money, terms, and risk.
3. **Community** — We build communities that create generational impact.
4. **Innovation** — We use technology to unlock new possibilities.
5. **Integrity** — We do the right thing for artists, fans, and the culture.

### 1.7 Audiences
- **Artists (independent creators):** ambitious, brand-conscious, allergic to label deals. Want capital, ownership, data, and a direct line to fans. Speak to them as founders of their own business.
- **Fans (investors / supporters):** culturally engaged, want access and upside. Range from casual subscribers to genuine micro-investors. Speak to belief, access, and ownership — always with honest risk framing.
- **Secondary:** event organizers, compliance/admin users, broker-dealer partners, investors in FanZuP itself.

### 1.8 Tagline & messaging hierarchy
- **Primary tagline:** *Fund the culture. Own the future.*
- **Descriptor:** *The direct-to-fan funding infrastructure that empowers artists and rewards belief.*
- **Artist-facing:** *Own your art. Fund your future.*
- **Fan-facing:** *Back the artists you believe in — and share in what they build.*

---

## 2. Logo

### 2.1 Components
- **FZ monogram (primary mark):** an angular **gold "F" + "Z"** locked together with a 3-D facet cut. This is the official mark — used wherever the full wordmark won't fit (app icon, avatar, favicon, watermark). Files: `assets/logo/fanzup-monogram-on-black.png` (tile) and `…-transparent.png` (inline on dark).
- **Wordmark:** `FANZUP` set in Space Grotesk Bold, tight tracking — **FAN** in off-white `#F5F5F7`, **ZUP** in gold `#D4AF37`.
- **Primary lockup:** FZ monogram + `FANZUP` wordmark, horizontal.
- **Lockups:** monogram in a **rounded square** (app icon) and in a **circle** (avatar / stamp).

> The current PNGs are extracted from the approved brand board (raster, limited resolution). Replace with the **original vector logo file** for hi-res/print before production.

### 2.2 Primary & secondary lockups
| Lockup | Use |
|---|---|
| **Wordmark on black** (primary) | Default everywhere on dark surfaces. |
| **Wordmark on gold/white** (secondary) | Use the all-black wordmark on light or gold backgrounds. |
| **Monogram, rounded square** | App icon, mobile, favicons, social avatars. |
| **Monogram, circle** | Stamps, watermarks, loading states, profile rings. |

### 2.3 Clear space & minimum size
- **Clear space:** keep a margin equal to the height of the "F" cap on all sides. Nothing (text, image edge, other logos) intrudes.
- **Minimum sizes:** Wordmark ≥ **120px** wide (digital) / 25mm (print). Monogram ≥ **24px** (favicon ≥ 16px using the simplified bolt only).

### 2.4 Logo color rules
- **On black / charcoal (`#0B0B0D`, `#17181C`):** gold FZ monogram + FAN (off-white) / ZUP (gold) wordmark. **This is the default and dominant context.**
- **On gold or white / light:** use an all-black version of the monogram + wordmark (needs to be produced from the vector source).
- **Single-color contexts:** all-gold or all-black; never mix in a third color.

### 2.5 Do's and don'ts
**Do**
- Keep the FZ monogram geometry and facets intact and crisp.
- Use approved color pairings only (§2.4).
- Give it room (§2.3).

**Don't**
- ❌ Recolor the mark outside gold/black/white.
- ❌ Stretch, skew, rotate, or add drop shadows/outlines/gradients not in the kit.
- ❌ Place the gold logo on a busy photo without a scrim/overlay (see §6.3).
- ❌ Recreate the wordmark in a different font, or change the FAN/ZUP color split.
- ❌ Use the retired purple logo or any v1.0 asset.

---

## 3. Color

The palette is **dark-first**: a near-black canvas, a single luminous gold as the hero, restrained neutrals, and a tight set of accent/data colors. Gold is for moments that matter — it should feel earned, not everywhere.

### 3.1 Core neutrals (foundation)
| Token | Hex | Use |
|---|---|---|
| `--bg-black` | `#0B0B0D` | App / page background, primary canvas. |
| `--surface-charcoal` | `#17181C` | Cards, panels, raised surfaces, nav. |
| `--surface-charcoal-2` | `#212329` | Hover/elevated surface, input fields. |
| `--border-subtle` | `#2A2C33` | Hairlines, dividers, card borders. |
| `--text-muted` | `#8E929B` | Secondary text, captions, labels. |
| `--text-primary` | `#F5F5F7` | Primary text, headings on dark. |

### 3.2 Brand gold (primary)
| Token | Hex | Use |
|---|---|---|
| `--gold-deep` | `#B8932F` | Pressed states, gradients (low end), borders. |
| `--gold` | `#D4AF37` | **Primary brand color** — logo, primary CTAs, key highlights, focus. |
| `--gold-champagne` | `#F0D98A` | Hover sheen, gradient high end, subtle highlights. |

**Signature gradient:** `linear-gradient(135deg, #B8932F 0%, #D4AF37 50%, #F0D98A 100%)` — for hero accents, the bolt, and premium surfaces (e.g., the All-Access card). Use sparingly.

### 3.3 Accent & data-visualization
Used for charts, categories, and secondary highlights — never as primary brand color.
| Token | Hex | Meaning |
|---|---|---|
| `--accent-cyan` | `#00D4FF` | Data series, "Streaming," links on dark. |
| `--accent-teal` | `#00888B` | Data series, secondary category. |
| `--accent-mint` | `#16C784` | Positive trend, gains, "Revenue up." |
| `--accent-navy` | `#102A43` | Deep panel tint, chart backdrop. |

### 3.4 Semantic
| Token | Hex | Use |
|---|---|---|
| `--success` | `#00C853` | Funded, approved, verified, positive payout. |
| `--warning` | `#FFB300` | Pending review, caution, draft. |
| `--error` | `#E33035` | Rejected, failed, validation error. |
| `--info` | `#00D4FF` | Neutral notifications, helper context. |

> Note: success green `#00C853` and brand gold are visually distinct on purpose — gold = brand/CTA, green = positive financial state. Don't use gold to signal "success."

### 3.5 Usage ratio (60 / 30 / 10)
- **60% — Black & charcoal** (`#0B0B0D`, `#17181C`): the canvas.
- **30% — Neutral text & surfaces** (`#F5F5F7`, `#8E929B`, borders).
- **10% — Gold + accents:** CTAs, highlights, data. Gold should never dominate a screen.

### 3.6 Accessibility (WCAG 2.2 AA, dark mode)
Verified contrast ratios on the `#0B0B0D` background:

| Foreground | On | Ratio | Verdict |
|---|---|---|---|
| Off-white `#F5F5F7` | Black `#0B0B0D` | **18.4:1** | AAA ✓ |
| Gold `#D4AF37` | Black `#0B0B0D` | **9.3:1** | AAA ✓ (headings, large text, icons) |
| Cool gray `#8E929B` | Black `#0B0B0D` | **6.3:1** | AA ✓ (body, secondary) |
| Black `#0B0B0D` | Gold `#D4AF37` | **9.3:1** | AAA ✓ (text on gold buttons) |

**Critical rule:** ❌ **Never put white/off-white text on gold** — `#F5F5F7` on `#D4AF37` is ~2.0:1 and fails. Buttons and chips with a gold fill must use **black** text (`#0B0B0D`).

**Focus states:** 2px gold ring (`#D4AF37`, ≥3:1 against background). Never remove focus outlines.

### 3.7 CSS tokens
```css
:root {
  /* Foundation */
  --bg-black:           #0B0B0D;
  --surface-charcoal:   #17181C;
  --surface-charcoal-2: #212329;
  --border-subtle:      #2A2C33;
  --text-muted:         #8E929B;
  --text-primary:       #F5F5F7;

  /* Brand gold */
  --gold-deep:      #B8932F;
  --gold:           #D4AF37;
  --gold-champagne: #F0D98A;
  --gold-gradient:  linear-gradient(135deg, #B8932F 0%, #D4AF37 50%, #F0D98A 100%);

  /* Accent / data */
  --accent-cyan: #00D4FF;
  --accent-teal: #00888B;
  --accent-mint: #16C784;
  --accent-navy: #102A43;

  /* Semantic */
  --success: #00C853;
  --warning: #FFB300;
  --error:   #E33035;
  --info:    #00D4FF;
}
```

---

## 4. Typography

A two-typeface system with a numeric workhorse for money.

### 4.1 Typefaces
| Role | Typeface | Notes |
|---|---|---|
| **Display / Headings** | **Space Grotesk** (Bold/Medium) | Geometric, slightly technical — bold finance-meets-culture energy. Use for H1–H3, hero, stats, the wordmark. |
| **Body / UI** | **Inter** (Regular/Medium/Semibold) | Highly legible at small sizes; default for all body, labels, and UI. |
| **Numeric / Financial** | **JetBrains Mono** (Medium) | Tabular figures for amounts, unit counts, transaction IDs, percentages, and tables — keeps columns aligned. |

```css
--font-display: "Space Grotesk", "SF Pro Display", system-ui, sans-serif;
--font-body:    "Inter", "SF Pro Text", system-ui, sans-serif;
--font-mono:    "JetBrains Mono", "SF Mono", ui-monospace, monospace;
```

### 4.2 Type scale (1.25 major-third)
| Token | Size | Typeface / Weight | Use |
|---|---|---|---|
| Display | 60px / 3.75rem | Space Grotesk Bold | Hero headline |
| H1 | 48px / 3rem | Space Grotesk Bold | Page title |
| H2 | 36px / 2.25rem | Space Grotesk Bold | Major section |
| H3 | 30px / 1.875rem | Space Grotesk Medium | Section / card title |
| H4 | 24px / 1.5rem | Space Grotesk Medium | Subsection |
| Lg | 20px / 1.25rem | Inter Medium | Lead paragraph |
| Base | 16px / 1rem | Inter Regular | Body text |
| Sm | 14px / 0.875rem | Inter Regular | Secondary, captions |
| Xs | 12px / 0.75rem | Inter Medium | Labels, fine print, eyebrows |
| Stat | 36–60px | JetBrains Mono Medium | $ amounts, big numbers |

### 4.3 Rules
- **Headlines:** Space Grotesk Bold, tracking `-0.02em`, line-height 1.05–1.15.
- **Eyebrows / labels:** Inter, uppercase, tracking `+0.08em`, 12px, in `--text-muted` or gold.
- **Money & metrics:** always JetBrains Mono with tabular figures (`font-variant-numeric: tabular-nums`).
- **Line length:** body max ~70 characters.
- **Don't** use Space Grotesk for long body copy, and don't set gold body text (gold is for headings/accents/CTAs).

---

## 5. Iconography

- **Library:** [Lucide](https://lucide.dev) — line style, consistent **2px stroke**. (~116 curated icons across navigation, actions, status, media, finance — see `ICON_LIBRARY.md`.)
- **Sizes:** 16 / 20 (default) / 24px. Touch targets ≥ 44×44px.
- **Color:** inherit `--text-muted` by default; **gold** (`#D4AF37`) for active/primary, semantic colors for status. Never multicolor a single icon.
- **Brand category icons** (Dashboard, Funding, Revenue, Community, Compliance, Payments): line style, gold accent, housed in rounded-square chips on charcoal.
- **Motif:** the **angular, faceted geometry of the FZ monogram** (and the energy of its gold-on-black Z slash) is the brand's signature shape — echo it in motion/empowerment moments (loading, success, "boost"), but don't overuse to the point of cliché.

---

## 6. Imagery & Art Direction

### 6.1 Photography
- **Subjects:** independent artists in their element — on stage, in studio, with crowds. Real, aspirational, not stock-y.
- **Treatment:** **dramatic, low-key lighting** against dark backgrounds; warm/gold rim light where possible. High contrast, cinematic.
- **Crowd & culture:** silhouettes, raised hands, live energy — reinforces "fund the culture."

### 6.2 Graphic style
- **Dark canvas + gold light.** Think spotlight, lens flare, lightning, embossed gold on black.
- **Data is a hero:** charts (waterfall, line, donut) using gold + cyan/teal/mint on charcoal are core brand imagery, not afterthoughts.
- **Premium objects:** matte-black "All-Access" cards with gold foil; subtle metallic gradients.

### 6.3 Overlays
- Any text or logo over a photo needs a scrim: `linear-gradient(180deg, rgba(11,11,13,0) 0%, rgba(11,11,13,0.85) 100%)` or a 40–60% black overlay, so contrast stays AA.

### 6.4 Avoid
- Bright, flat, "happy SaaS" illustration; literal money/cash-rain clichés; the retired purple/pink palette; over-gilding (gold everywhere cheapens it).

---

## 7. Voice & Tone

### 7.1 Principles
1. **Confident, not hype.** We make bold claims and substantiate them with numbers. No empty superlatives.
2. **Clear about money.** Plain language on terms, returns, fees, and risk. Never bury the disclosure.
3. **For the culture.** We talk like we belong in music, not in a bank — but we never sacrifice precision for slang.
4. **Empowering, second person.** "Own your art." "Your fans, your future." Put the artist/fan in the driver's seat.

### 7.2 Tone by context
| Context | Tone |
|---|---|
| Marketing / landing | Bold, aspirational, energetic. |
| Onboarding / product | Encouraging, clear, low-friction. |
| Money / investment screens | Calm, precise, transparent. |
| Errors / compliance | Direct, human, reassuring — never alarmist or jargon-heavy. |

### 7.3 Do / Don't
- ✅ "Raise up to $100K from the fans who already believe in you."
- ❌ "Get rich quick by going viral." (over-promise, non-compliant)
- ✅ "Funds are held in escrow until your goal is met. If it isn't, every fan is refunded automatically."
- ❌ "Your money's totally safe, don't worry about it." (vague, dismissive of risk)
- ✅ "Back the come-up. Share in the upside."
- ❌ "Guaranteed returns." (never — see §7.4)

### 7.4 Regulated-language rules (read before publishing investment copy)
FanZuP investment products are **securities under SEC Reg CF**. Investor-facing copy must:
- **Never** promise, guarantee, or imply guaranteed returns, "safe investment," or specific performance.
- Frame returns as *potential* and always pair upside with **risk of loss**.
- Avoid "investment advice" phrasing; FanZuP provides infrastructure, not advice.
- Keep required disclosures (escrow, Form C, broker-dealer intermediary, return caps/maturity) visible, not hidden in footnotes.
- When in doubt, route copy through compliance before publishing. *(This section is brand guidance, not legal advice.)*

### 7.5 Naming
- Canonical brand name: **FanZuP** (capital F, Z, P). Not "Fanzup," "FANZUP" (except in the all-caps logo wordmark), or "Fan Zup."
- Product nouns: **Pools** (Brand / Creator / Project), **Units**, **Wallet**, **Waterfall**, **Tiers** (Starter, Rising, Established, Pro), **All-Access**.

---

## 8. UI & Components

Full specs live in `DESIGN_SYSTEM.md` and `DESIGN_SYSTEM_GUIDELINES.md` (re-skinned to this brand). Brand-level rules:

- **Surfaces:** black canvas → charcoal cards (`#17181C`) → elevated `#212329`, separated by `--border-subtle` hairlines and shadow, not heavy outlines.
- **Primary button:** gold fill `#D4AF37`, **black** text, `radius-lg` (8px); hover → champagne sheen; pressed → `#B8932F`.
- **Secondary button:** transparent, 1px `--border-subtle` border, off-white text.
- **Destructive:** `#E33035`, white text, always confirm.
- **Cards:** `#17181C`, 24px padding, 12–16px radius, subtle border; interactive cards get a gold-edge glow on hover.
- **Badges:** green=verified/funded, amber=pending, red=rejected, cyan=new, gray=inactive. Title case, 1–2 words.
- **Inputs:** charcoal field, gold focus ring; clear labels + helper/error text.
- **Spacing:** 4px base grid; **never** off-grid values (5/15/18px).
- **Radius scale:** 6 / 8 / 12 / 16px; pills for tags/avatars.
- **Grid:** mobile 4-col / tablet 8-col / desktop 12-col, max content width 1440px (see `LAYOUT_GRID.md`).

---

## 9. Brand Applications

- **Mobile app:** dark UI, gold accents, JetBrains Mono for balances; dashboard, revenue flow, community, milestones (per mockups).
- **All-Access / membership card:** matte black, gold-foil bolt, embossed — the premium physical/virtual artifact of the brand.
- **Web platform:** black hero with gold headline split (e.g., "FUND THE CULTURE." in white / "OWN THE FUTURE." in gold), trust stats row, artist spotlight cards.
- **Social:** dark templates, gold wordmark, artist photography with scrim; campaign cards (Album, Tour, Documentary) with category badge + funding progress.
- **Pitch / investor deck:** same system; lead with stats ($28.6M+ raised · 166 artists · 47.3K+ investors · 92% projects funded — *update with live figures before external use*).

---

## 10. Governance

- **Source of truth:** this file + `DESIGN_SYSTEM.md` (tokens). The v1.0 purple/blue system is **retired** — do not use.
- **Changes:** version this document; note date + change in the header.
- **Asset kit:** the official **FZ monogram** (on-black + transparent PNGs) and favicon/app-icon PNG sizes + `site.webmanifest` live in `assets/` (see `assets/README.md`). Still to produce: vector logo master, all-black logo version (for light/gold backgrounds), Space Grotesk + Inter + JetBrains Mono web-font bundle, social templates, card mockups.
- **Open items / flags:**
  - Replace placeholder stats with verified live numbers before any external/investor use.
  - The logo PNGs are **extracted from the brand-board raster** (limited resolution). Source the **original vector logo file** and re-run favicon export for hi-res/print.
  - Produce an **all-black monogram + wordmark** for use on gold/light backgrounds.
  - Confirm Space Grotesk + JetBrains Mono licensing for production web embedding (both are OFL/free — verify before shipping).

---

*FanZuP · Brand Guidelines v2.0 · June 2026 · Confidential. Fund the culture. Own the future.*
