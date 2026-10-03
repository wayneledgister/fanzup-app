# Build conventions — FanZuP app

Read this, `docs/CONSOLIDATION.md`, and `docs/brand/BRAND_GUIDELINES.md` §3–§8 before building a page. `src/pages/public/Landing.tsx` is the reference implementation: match its quality bar.

## Stack
Vite 6 · React 18 · TypeScript (strict) · Tailwind v4 (`src/styles/index.css` holds all tokens) · react-router 7 (`createBrowserRouter`) · lucide-react icons. Import alias `@/` → `src/`.

Routes are generated: edit `scripts/routes.manifest.json` then run `node scripts/gen-routes.mjs`. Each page is a **default export** at `src/pages/<area>/<Name>.tsx`. The manifest's 5th column names the wireframe source in `/home/claude/figma-src/fps/` (Fan Profile Setup) or `/home/claude/figma-src/fanzup/` (FanZuP).

## The wireframes are a content/structure spec, not a style
The Fan Profile Setup pages are grayscale lo-fi wireframes (font-mono, `#2a2a2a` borders, "Screen:" annotations, viewport toggles, showcase wrappers). Use them for **what's on the screen, the fields, the states and the flow**. Do not copy their markup, colors, annotations, or showcase chrome. Where a wireframe page shows multiple states side by side (a "showcase"), implement the real page with those states reachable (tabs, query param `?state=`, or realistic conditional rendering).

## Styling rules (non-negotiable)
- Compose from `@/components/brand`: `Button`, `Card`, `Badge`, `Container`, `PageHeader`, `SectionHeading`, `Stat`, `Money`, `ProgressBar`, `FundingProgress`, `Stepper`, `Field`, `TextInput`, `TextArea`, `Select`, `Checkbox`, `ChoiceCard`, `Callout`, `EmptyState`, `IconChip`, `KeyValue`, `Divider`, `ArtistArt`, `Logo`, plus disclosures `EscrowNotice`, `InvestmentRiskDisclosure`, `LockupNotice`, `RegulatoryFooter`, `FormCLink`, and gates `FeatureRoute`, `WhenFlag`.
- Color only via token utilities: `bg-canvas bg-surface bg-surface-2 border-line text-fg text-muted text-gold bg-gold text-on-gold`, semantic `text-success|warning|error|info`, data `accent-cyan|teal|mint|navy`. **No hex literals, no gray-/white/black Tailwind palette classes** (exception: `bg-black/60` overlay scrims).
- Gold ≈ 10% of a screen: one primary CTA per view, active nav, focus, a key number. Never gold for "success" (use `success`). **Never white text on gold** — gold fills use `text-on-gold` (Button does this).
- Every money amount, count, percentage, date-countdown, ID → `num` class or `<Money>` / `<Stat>`. Amounts are integers in **cents** (`priceMinor`, `raisedMinor`).
- Type: headings use default h1–h4 (Space Grotesk). Eyebrows use `.eyebrow`. Body Inter.
- Spacing on the 4px grid (Tailwind default scale). Radius `rounded-md` (8) buttons/inputs, `rounded-lg` (12) cards, `rounded-full` pills/avatars.
- Mobile-first, works at 390px with 16px gutters (use `Container`). No horizontal scroll. Touch targets ≥ 44px.
- Accessibility: real `<label>`s (use `Field`), `aria-*` on custom controls, icon-only buttons need `aria-label`, keep focus rings.
- Images: no stock photos or external image URLs. Use `<ArtistArt seed label />` for artist/campaign art.
- Data: use `@/lib/mock` (fictional artists, campaigns, pools, holdings, events, merch, perks, fan). Add to it only if you must, and only append (other people edit it too) — prefer local constants in your page.
- State: `useState`; no localStorage for app data. Forms validate inline and show errors via `Field error`.
- Navigation between steps uses `useNavigate` / `<Link>` to the real routes in the manifest.

## Copy rules (Brand §7, PRD 01 §11) — `pnpm lint:copy` enforces part of this
- Name: **FanZuP**. Product nouns: Pools (Brand/Creator/Project), Units, Wallet, Waterfall, Tiers **Starter / Rising / Established / Pro**, All-Access.
- **Layer 1 (default)**: campaigns are reward-based. Backers get perks. Never say invest, returns, share of revenue, units, or ownership in Layer 1 flows. Escrow promise: `<EscrowNotice />`.
- **Layer 2 (flag `layer2`)**: "potential" payouts, always paired with risk; `<InvestmentRiskDisclosure />` before any purchase; show Form C link, Reg CF limit, 12-month lock-up; never imply liquidity, never sort/rank by expected return, never show leaderboards by money invested.
- Banned: yield, APY, ROI, stake/staking, guaranteed, "earn returns", safe investment, tradeable/liquidity, on-chain/crypto/ETH/USDC/wallet addresses, "SEC registered/approved/compliant", invented partners, Star/Nebula/Galaxy/Supernova dollar tiers.
- Voice: confident, plain, second person. Money screens calm and precise. Errors direct and human.
- Fees: platform fee percentages are **TBD** per `docs/brand/fees.html`; only Stripe pass-through (2.9% + $0.30) is known. Don't invent numbers.

## Definition of done for a page
1. No `PagePlaceholder` left; top-of-file doc comment: `Source: <wireframe>` + one line on doc-driven changes.
2. `pnpm typecheck` and `pnpm lint:copy` pass.
3. Screenshot at 1440 and 390 widths looks finished and on brand (see below), no console errors.

## Screenshots
`node /home/claude/shots/shot.mjs <path> <out.png> <width> [query]` hits `http://localhost:4173`. If you run your own server, use your assigned port: `pnpm vite --port <PORT> --strictPort` and run `PORT=<PORT> node /home/claude/shots/shot.mjs ...`. Use `?flags=layer2,postBeta` to view gated pages.
