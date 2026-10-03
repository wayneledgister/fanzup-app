import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import * as I from "lucide-react";
import {
  ArtistArt, Badge, Button, Callout, Card, Checkbox, ChoiceCard, Container, EmptyState, EscrowNotice, Field, FundingProgress, IconChip,
  InvestmentRiskDisclosure, KeyValue, Logo, Money, ProgressBar, Select, Stat, Stepper, TextArea, TextInput,
} from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * Source: FPS ComponentShowcase.tsx + DesignSystemDocs.tsx + IconLibrary.tsx + LayoutGrid.tsx (section structure only).
 * Doc-driven changes: all content regenerated from Brand v2.0 tokens (src/styles/index.css, BRAND_GUIDELINES §3–§8)
 * and the real brand components — the wireframes' retired purple v1.0 palette, type and specimens are not used.
 * Modals / toasts / tooltips sections omitted until brand versions of those components exist.
 */

const SECTIONS = [
  ["color", "Color"],
  ["type", "Typography"],
  ["buttons", "Buttons"],
  ["badges", "Badges"],
  ["inputs", "Inputs"],
  ["cards", "Cards"],
  ["callouts", "Callouts & disclosures"],
  ["progress", "Progress & numbers"],
  ["stepper", "Stepper"],
  ["icons", "Icons"],
  ["layout", "Layout grid"],
] as const;

type Swatch = { name: string; cls: string; util: string; hex: string; use: string; ring?: boolean };
const COLORS: { group: string; note?: string; items: Swatch[] }[] = [
  {
    group: "Foundation",
    note: "60% of every screen. Canvas → surface → elevated, separated by hairlines.",
    items: [
      { name: "Canvas", cls: "bg-canvas", util: "bg-canvas", hex: "#0B0B0D", use: "Page background", ring: true },
      { name: "Surface", cls: "bg-surface", util: "bg-surface", hex: "#17181C", use: "Cards, panels, nav" },
      { name: "Surface 2", cls: "bg-surface-2", util: "bg-surface-2", hex: "#212329", use: "Hover, elevated, inputs" },
      { name: "Line", cls: "bg-line", util: "border-line", hex: "#2A2C33", use: "Hairlines, borders" },
      { name: "Muted", cls: "bg-muted", util: "text-muted", hex: "#8E929B", use: "Secondary text, labels" },
      { name: "Foreground", cls: "bg-fg", util: "text-fg", hex: "#F5F5F7", use: "Primary text, headings" },
    ],
  },
  {
    group: "Brand gold",
    note: "≈10% of a screen: one primary CTA, active nav, focus, a key number. Never for “success”.",
    items: [
      { name: "Gold deep", cls: "bg-gold-deep", util: "bg-gold-deep", hex: "#B8932F", use: "Pressed, gradient low end" },
      { name: "Gold", cls: "bg-gold", util: "bg-gold · text-gold", hex: "#D4AF37", use: "Primary CTA, focus, highlights" },
      { name: "Champagne", cls: "bg-gold-champagne", util: "bg-gold-champagne", hex: "#F0D98A", use: "Hover sheen, gradient high end" },
      { name: "Gold gradient", cls: "bg-gold-gradient", util: "bg-gold-gradient", hex: "135° deep → gold → champagne", use: "Hero accents, All-Access card — sparingly" },
    ],
  },
  {
    group: "Accent & data",
    note: "Charts and categories only — never as the primary brand color.",
    items: [
      { name: "Cyan", cls: "bg-accent-cyan", util: "accent-cyan", hex: "#00D4FF", use: "Data series, streaming, links on dark" },
      { name: "Teal", cls: "bg-accent-teal", util: "accent-teal", hex: "#00888B", use: "Secondary data series" },
      { name: "Mint", cls: "bg-accent-mint", util: "accent-mint", hex: "#16C784", use: "Positive trend" },
      { name: "Navy", cls: "bg-accent-navy", util: "accent-navy", hex: "#102A43", use: "Deep panel tint, chart backdrop" },
    ],
  },
  {
    group: "Semantic",
    items: [
      { name: "Success", cls: "bg-success", util: "text-success", hex: "#00C853", use: "Funded, approved, verified" },
      { name: "Warning", cls: "bg-warning", util: "text-warning", hex: "#FFB300", use: "Pending review, draft, caution" },
      { name: "Error", cls: "bg-error", util: "text-error", hex: "#E33035", use: "Rejected, failed, validation" },
      { name: "Info", cls: "bg-info", util: "text-info", hex: "#00D4FF", use: "Neutral notices, helper context" },
    ],
  },
];

const CONTRAST = [
  { fg: "text-fg", bg: "bg-canvas", pair: "Foreground on canvas", ratio: "18.4:1", verdict: "AAA", ok: true },
  { fg: "text-gold", bg: "bg-canvas", pair: "Gold on canvas", ratio: "9.3:1", verdict: "AAA — headings, large text, icons", ok: true },
  { fg: "text-muted", bg: "bg-canvas", pair: "Muted on canvas", ratio: "6.3:1", verdict: "AA — body, secondary", ok: true },
  { fg: "text-on-gold", bg: "bg-gold", pair: "Black on gold", ratio: "9.3:1", verdict: "AAA — text on gold buttons", ok: true },
  { fg: "text-fg", bg: "bg-gold", pair: "White on gold", ratio: "≈2.0:1", verdict: "Fails — never use", ok: false },
];

const TYPE = [
  { token: "Display", size: "60 / 3.75rem", spec: "Space Grotesk Bold", cls: "font-display text-6xl font-bold", sample: "Fund the culture." },
  { token: "H1", size: "48 / 3rem", spec: "Space Grotesk Bold", cls: "font-display text-5xl font-bold", sample: "Page title" },
  { token: "H2", size: "36 / 2.25rem", spec: "Space Grotesk Bold", cls: "font-display text-4xl font-bold", sample: "Major section" },
  { token: "H3", size: "30 / 1.875rem", spec: "Space Grotesk Medium", cls: "font-display text-3xl font-medium", sample: "Card title" },
  { token: "H4", size: "24 / 1.5rem", spec: "Space Grotesk Medium", cls: "font-display text-2xl font-medium", sample: "Subsection" },
  { token: "Lg", size: "20 / 1.25rem", spec: "Inter Medium", cls: "text-xl font-medium", sample: "Lead paragraph for a page." },
  { token: "Base", size: "16 / 1rem", spec: "Inter Regular", cls: "text-base", sample: "Body copy. Keep lines under ~70 characters." },
  { token: "Sm", size: "14 / 0.875rem", spec: "Inter Regular", cls: "text-sm", sample: "Secondary text and captions." },
  { token: "Xs", size: "12 / 0.75rem", spec: "Inter Medium", cls: "eyebrow", sample: "Eyebrow · label" },
  { token: "Stat", size: "36–60", spec: "JetBrains Mono Medium", cls: "num text-5xl font-medium", sample: "$18,700" },
];

const ICONS: { group: string; icons: [string, I.LucideIcon][] }[] = [
  { group: "Navigation", icons: [["Home", I.Home], ["Search", I.Search], ["Bell", I.Bell], ["User", I.User], ["Settings", I.Settings], ["Menu", I.Menu], ["ChevronRight", I.ChevronRight], ["ChevronDown", I.ChevronDown], ["ArrowLeft", I.ArrowLeft], ["ArrowRight", I.ArrowRight], ["MoreHorizontal", I.MoreHorizontal]] },
  { group: "Actions", icons: [["Plus", I.Plus], ["X", I.X], ["Check", I.Check], ["Edit", I.Pencil], ["Trash2", I.Trash2], ["Copy", I.Copy], ["Download", I.Download], ["Upload", I.Upload], ["Share2", I.Share2], ["Send", I.Send], ["Save", I.Save], ["Filter", I.Filter]] },
  { group: "Status", icons: [["CheckCircle2", I.CircleCheck], ["XCircle", I.CircleX], ["AlertCircle", I.CircleAlert], ["AlertTriangle", I.TriangleAlert], ["Info", I.Info], ["Clock", I.Clock], ["Eye", I.Eye], ["Lock", I.Lock], ["ShieldCheck", I.ShieldCheck], ["ShieldAlert", I.ShieldAlert], ["TrendingUp", I.TrendingUp], ["TrendingDown", I.TrendingDown]] },
  { group: "Media", icons: [["Music", I.Music], ["Mic", I.Mic], ["Headphones", I.Headphones], ["Play", I.Play], ["Pause", I.Pause], ["Video", I.Video], ["Film", I.Film], ["Camera", I.Camera], ["Image", I.Image], ["Volume2", I.Volume2]] },
  { group: "Social", icons: [["Mail", I.Mail], ["MessageCircle", I.MessageCircle], ["Users", I.Users], ["UserPlus", I.UserPlus], ["Heart", I.Heart], ["Star", I.Star], ["ThumbsUp", I.ThumbsUp]] },
  { group: "Commerce & finance", icons: [["CreditCard", I.CreditCard], ["DollarSign", I.DollarSign], ["Tag", I.Tag], ["Gift", I.Gift], ["ShoppingCart", I.ShoppingCart], ["BarChart3", I.ChartColumn], ["PieChart", I.ChartPie], ["Receipt", I.Receipt]] },
  { group: "Files, time & place", icons: [["FileText", I.FileText], ["Folder", I.Folder], ["Link", I.Link], ["ExternalLink", I.ExternalLink], ["Calendar", I.Calendar], ["CalendarDays", I.CalendarDays], ["MapPin", I.MapPin], ["Globe", I.Globe]] },
  { group: "Misc", icons: [["Award", I.Award], ["Zap", I.Zap], ["Target", I.Target], ["Flag", I.Flag], ["Bookmark", I.Bookmark], ["HelpCircle", I.CircleHelp], ["Building2", I.Building2], ["Briefcase", I.Briefcase]] },
];

const GRID = {
  mobile: { label: "Mobile", bp: "375", cols: 4, gutter: 16, margin: 16 },
  tablet: { label: "Tablet", bp: "768", cols: 8, gutter: 24, margin: 32 },
  desktop: { label: "Desktop", bp: "1280+", cols: 12, gutter: 24, margin: 80 },
} as const;

export default function DesignSystem() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <Container size="xl" className="flex h-16 items-center justify-between gap-4">
          <Link to="/" aria-label="FanZuP home" className="flex items-center gap-3">
            <Logo size="sm" />
            <span className="hidden border-l border-line pl-3 text-sm text-muted sm:inline">Design system</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <I.ArrowLeft /> Back to app
            </Link>
          </Button>
        </Container>
      </header>

      <Container size="xl" className="grid gap-10 py-10 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-24 flex flex-col gap-1 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-3 py-2 text-muted transition-colors hover:bg-surface hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-col gap-20">
          <div className="flex flex-col gap-3">
            <span className="eyebrow text-gold">Brand v2.0 · living style guide</span>
            <h1 className="text-4xl font-bold sm:text-5xl">FanZuP design system</h1>
            <p className="max-w-2xl text-muted">
              Every specimen on this page is rendered from the production tokens in <code className="num text-fg">src/styles/index.css</code> and the
              components in <code className="num text-fg">@/components/brand</code>. If it looks wrong here, it's wrong everywhere.
            </p>
            <div className="flex flex-wrap gap-2 lg:hidden">
              {SECTIONS.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-fg">
                  {label}
                </a>
              ))}
            </div>
          </div>

          {/* ── Color ── */}
          <Block id="color" title="Color" lead="Dark-first: a near-black canvas, one luminous gold, restrained neutrals and a tight set of data colors.">
            <div className="flex flex-col gap-2">
              <div className="flex h-4 overflow-hidden rounded-full" aria-hidden>
                <div className="w-[60%] bg-surface-2" />
                <div className="w-[30%] bg-muted/50" />
                <div className="w-[10%] bg-gold" />
              </div>
              <div className="flex justify-between text-xs text-muted">
                <span>
                  <span className="num">60%</span> canvas & charcoal
                </span>
                <span>
                  <span className="num">30%</span> neutral text & surfaces
                </span>
                <span>
                  <span className="num">10%</span> gold & accents
                </span>
              </div>
            </div>
            {COLORS.map((g) => (
              <div key={g.group} className="flex flex-col gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{g.group}</h3>
                  {g.note && <p className="text-sm text-muted">{g.note}</p>}
                </div>
                <div className={cn("grid gap-3 sm:grid-cols-2", g.items.length === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
                  {g.items.map((c) => (
                    <div key={c.name} className="flex overflow-hidden rounded-lg border border-line bg-surface">
                      <div className={cn("w-16 shrink-0 border-r border-line", c.cls)} aria-hidden />
                      <div className="flex min-w-0 flex-col gap-0.5 p-3">
                        <p className="font-medium">{c.name}</p>
                        <p className="num text-xs text-fg">{c.hex}</p>
                        <p className="num truncate text-xs text-muted">{c.util}</p>
                        <p className="text-xs text-muted">{c.use}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-3">
              <h3 className="text-lg font-semibold">Contrast (WCAG 2.2 AA, dark mode)</h3>
              <Card padded={false} className="relative overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <caption className="sr-only">Verified contrast ratios</caption>
                  <thead className="bg-surface-2 text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">Sample</th>
                      <th className="px-4 py-3 font-medium">Pair</th>
                      <th className="px-4 py-3 text-right font-medium">Ratio</th>
                      <th className="px-4 py-3 font-medium">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CONTRAST.map((r) => (
                      <tr key={r.pair} className="border-t border-line">
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex h-9 w-14 items-center justify-center rounded-md border border-line font-display font-bold", r.bg, r.fg)}>Aa</span>
                        </td>
                        <td className="px-4 py-3 text-fg">{r.pair}</td>
                        <td className="num px-4 py-3 text-right text-fg">{r.ratio}</td>
                        <td className={cn("px-4 py-3", r.ok ? "text-muted" : "text-error")}>{r.verdict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <p className="text-sm text-muted">
                Focus: 2px gold ring, ≥ 3:1 against the background. Never remove focus outlines. Gold fills always carry black text (
                <code className="num">text-on-gold</code>).
              </p>
            </div>
          </Block>

          {/* ── Type ── */}
          <Block id="type" title="Typography" lead="Space Grotesk for display, Inter for everything you read, JetBrains Mono for every number that means money.">
            <Card padded={false}>
              <ul>
                {TYPE.map((t) => (
                  <li key={t.token} className="grid gap-2 border-t border-line p-4 first:border-t-0 sm:grid-cols-[9rem_1fr] sm:items-baseline sm:gap-6 sm:p-5">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-fg">{t.token}</span>
                      <span className="num text-xs text-muted">{t.size}</span>
                      <span className="text-xs text-muted">{t.spec}</span>
                    </div>
                    <p className={cn("min-w-0 truncate", t.cls, t.token === "Display" && "text-4xl sm:text-6xl", t.token === "H1" && "text-4xl sm:text-5xl")}>{t.sample}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
              <li>Headlines: tracking −0.02em, line-height 1.05–1.15.</li>
              <li>Eyebrows: Inter 12px uppercase, +0.08em, muted or gold.</li>
              <li>
                Money & metrics: always <code className="num text-fg">.num</code> (tabular figures).
              </li>
              <li>No Space Grotesk for long body copy; no gold body text.</li>
            </ul>
          </Block>

          {/* ── Buttons ── */}
          <Block id="buttons" title="Buttons" lead="One primary (gold) action per view. Secondary is a hairline outline. Destructive always confirms.">
            <Specimen label="Variants">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </Specimen>
            <Specimen label="Sizes">
              <Button size="sm">Small · 36</Button>
              <Button size="md">Medium · 44</Button>
              <Button size="lg">Large · 48</Button>
            </Specimen>
            <Specimen label="Icon & states">
              <Button>
                <I.HandCoins /> Back this campaign
              </Button>
              <Button variant="secondary">
                Continue <I.ArrowRight />
              </Button>
              <Button variant="secondary" size="icon" aria-label="Share">
                <I.Share2 />
              </Button>
              <Button disabled>Disabled</Button>
            </Specimen>
          </Block>

          {/* ── Badges ── */}
          <Block id="badges" title="Badges" lead="Title case, one or two words. Color carries meaning — pair it with a word.">
            <Specimen label="Status">
              <Badge tone="success" icon={<I.BadgeCheck />}>Verified</Badge>
              <Badge tone="success">Funded</Badge>
              <Badge tone="warning">Pending</Badge>
              <Badge tone="error">Rejected</Badge>
              <Badge tone="info">New</Badge>
              <Badge tone="neutral">Inactive</Badge>
              <Badge tone="gold">Fund My Show</Badge>
            </Specimen>
            <Specimen label="Counts">
              <Badge tone="neutral">
                <span className="num">12</span>&nbsp;left
              </Badge>
              <Badge tone="error">
                <span className="num">2</span>&nbsp;breached
              </Badge>
              <span className="num rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">3</span>
            </Specimen>
          </Block>

          {/* ── Inputs ── */}
          <Block id="inputs" title="Inputs" lead="Charcoal fields, gold focus ring, a real label above and helper or error text below.">
            <InputsDemo />
          </Block>

          {/* ── Cards ── */}
          <Block id="cards" title="Cards" lead="Surface #17181C, 24px padding, 12px radius, hairline border. Interactive cards get a gold-edge glow on hover.">
            <div className="grid gap-4 md:grid-cols-3 md:items-start">
              <Card>
                <p className="eyebrow">Default</p>
                <p className="mt-2 font-semibold">Surface card</p>
                <p className="mt-1 text-sm text-muted">Content containers and panels.</p>
              </Card>
              <Card elevated>
                <p className="eyebrow">Elevated</p>
                <p className="mt-2 font-semibold">Surface 2</p>
                <p className="mt-1 text-sm text-muted">Nested or raised content.</p>
              </Card>
              <Card interactive padded={false} className="overflow-hidden">
                <a href="#cards" className="block">
                  <ArtistArt seed="sol-amara" label="Sol Amara" className="aspect-[16/9] w-full rounded-none" />
                  <div className="p-5">
                    <p className="eyebrow">Interactive</p>
                    <p className="mt-2 font-semibold">Hover or focus me</p>
                  </div>
                </a>
              </Card>
            </div>
            <EmptyState icon={<I.Gift />} title="Empty state" action={<Button size="sm" variant="secondary">Primary next step</Button>}>
              Say what's missing and the one thing to do about it.
            </EmptyState>
          </Block>

          {/* ── Callouts ── */}
          <Block id="callouts" title="Callouts & disclosures" lead="Regulated copy lives in components — pages never write their own escrow or risk text.">
            <div className="grid gap-3 md:grid-cols-2">
              <Callout tone="info" icon={<I.Info />} title="Info">Helper context and neutral notices.</Callout>
              <Callout tone="success" icon={<I.CircleCheck />} title="Success">Approved, verified, funded.</Callout>
              <Callout tone="warning" icon={<I.TriangleAlert />} title="Warning">Pending, at risk, needs attention.</Callout>
              <Callout tone="error" icon={<I.CircleAlert />} title="Error">Direct and human. Say how to fix it.</Callout>
            </div>
            <div className="flex flex-col gap-2">
              <p className="eyebrow">EscrowNotice — Layer 1 reward campaigns</p>
              <EscrowNotice />
            </div>
            <div className="flex flex-col gap-2">
              <p className="eyebrow">InvestmentRiskDisclosure — Layer 2 only (behind the layer2 flag)</p>
              <InvestmentRiskDisclosure />
            </div>
          </Block>

          {/* ── Progress ── */}
          <Block id="progress" title="Progress & numbers" lead="Gold for progress in motion, green once a goal is met. Every amount in mono.">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="flex flex-col gap-5">
                <FundingProgress raisedMinor={1_870_000} goalMinor={2_500_000} backers={412} daysLeft={43} />
                <FundingProgress raisedMinor={812_500} goalMinor={800_000} backers={233} daysLeft={0} />
              </Card>
              <Card className="flex flex-col gap-4">
                <ProgressBar value={0.35} label="Gold" />
                <ProgressBar value={1} tone="success" label="Success" />
                <ProgressBar value={0.6} tone="info" label="Info" />
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <Stat label="Raised" value={<Money minor={1_870_000} />} accent />
                  <Stat label="Backers" value="412" hint="+18 this week" />
                </div>
                <div className="divide-y divide-line">
                  <KeyValue k="Perk" v={<Money minor={4000} />} />
                  <KeyValue k="Processing (2.9% + $0.30)" v={<Money minor={146} cents />} />
                </div>
              </Card>
            </div>
          </Block>

          {/* ── Stepper ── */}
          <Block id="stepper" title="Stepper" lead="Wizard progress. Labels hide below 640px; screen readers get “Step n of m”.">
            <Card className="flex flex-col gap-8">
              <Stepper steps={["Basics", "Details", "Perks", "Preview"]} current={1} />
              <Stepper steps={["Basics", "Details", "Perks", "Preview"]} current={3} />
            </Card>
          </Block>

          {/* ── Icons ── */}
          <Block id="icons" title="Icons" lead="Lucide, 2px stroke. 16 / 20 (default) / 24px. Muted by default, gold for active, semantic colors for status.">
            <Specimen label="Sizes">
              {[16, 20, 24].map((s) => (
                <span key={s} className="flex items-center gap-2 text-sm text-muted">
                  <I.Music style={{ width: s, height: s }} className="text-fg" />
                  <span className="num">{s}px</span>
                </span>
              ))}
              <span className="flex items-center gap-2 text-sm text-muted">
                <IconChip>
                  <I.ShieldCheck />
                </IconChip>
                Category chip
              </span>
            </Specimen>
            {ICONS.map((g) => (
              <div key={g.group} className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-muted">{g.group}</h3>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                  {g.icons.map(([name, Icon]) => (
                    <li key={name} className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface px-2 py-4 text-center">
                      <Icon className="size-5 text-fg" aria-hidden />
                      <span className="num w-full truncate text-[11px] text-muted" title={name}>
                        {name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-xs text-muted">Curated from docs/brand/ICON_LIBRARY.md. Names follow the library; some map to their current Lucide equivalents.</p>
          </Block>

          {/* ── Layout ── */}
          <Block id="layout" title="Layout grid" lead="Mobile 4 columns, tablet 8, desktop 12. Content tops out at 1440px. Spacing on a 4px grid — never 5, 15 or 18.">
            <GridDemo />
          </Block>
        </main>
      </Container>
    </div>
  );
}

function Block({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-24 flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-line pb-4">
        <h2 id={`${id}-h`} className="text-3xl font-bold">
          {title}
        </h2>
        <p className="max-w-2xl text-muted">{lead}</p>
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">{label}</p>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-5">{children}</div>
    </div>
  );
}

function InputsDemo() {
  const [agree, setAgree] = useState(true);
  const [choice, setChoice] = useState("supporter");
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="flex flex-col gap-5">
        <Field label="Campaign title" htmlFor="ds-title" hint="Up to 70 characters.">
          <TextInput id="ds-title" placeholder="Take the band on the road" />
        </Field>
        <Field label="Email" htmlFor="ds-email" error="Enter an email address like name@example.com.">
          <TextInput id="ds-email" defaultValue="jordan@" aria-invalid />
        </Field>
        <Field label="Genre" htmlFor="ds-genre">
          <Select id="ds-genre" defaultValue="rnb">
            <option value="rnb">Alt R&B</option>
            <option value="rock">Indie Rock</option>
          </Select>
        </Field>
        <Field label="Bio" htmlFor="ds-bio" optional>
          <TextArea id="ds-bio" rows={3} placeholder="Late-night R&B with live horns." />
        </Field>
      </Card>
      <Card className="flex flex-col gap-5">
        <Checkbox id="ds-agree" checked={agree} onChange={setAgree}>
          I agree to the Terms and Privacy Policy.
        </Checkbox>
        <div role="radiogroup" aria-label="Path" className="flex flex-col gap-3">
          {[
            { id: "supporter", t: "Supporter", d: "Back campaigns and get perks." },
            { id: "artist", t: "Artist", d: "Raise money from your fans." },
          ].map((c) => (
            <ChoiceCard key={c.id} selected={choice === c.id} onSelect={() => setChoice(c.id)}>
              <p className="font-semibold">{c.t}</p>
              <p className="text-sm text-muted">{c.d}</p>
            </ChoiceCard>
          ))}
        </div>
        <TextInput aria-label="Disabled example" disabled value="Disabled" readOnly />
      </Card>
    </div>
  );
}

function GridDemo() {
  const [bp, setBp] = useState<keyof typeof GRID>("desktop");
  const g = GRID[bp];
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Breakpoint" className="flex w-max gap-1 rounded-md border border-line bg-surface p-1">
        {(Object.keys(GRID) as (keyof typeof GRID)[]).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={bp === k}
            onClick={() => setBp(k)}
            className={cn("min-h-9 rounded-sm px-3 text-sm", bp === k ? "bg-surface-2 font-medium text-fg ring-1 ring-gold/50" : "text-muted hover:text-fg")}
          >
            {GRID[k].label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Breakpoint", `${g.bp}px`],
          ["Columns", String(g.cols)],
          ["Gutter", `${g.gutter}px`],
          ["Margin", `${g.margin}px`],
        ].map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="eyebrow">{k}</p>
            <p className="num mt-1 text-2xl text-fg">{v}</p>
          </Card>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface p-4" aria-label={`${g.cols}-column grid preview`}>
        <div className="grid h-40" style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`, gap: Math.max(4, g.gutter / 3) }}>
          {Array.from({ length: g.cols }, (_, i) => (
            <div key={i} className="flex items-end justify-center rounded-sm bg-gold/10 pb-2 ring-1 ring-inset ring-gold/25">
              <span className="num text-[10px] text-gold">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
      <ul className="grid gap-2 text-sm text-muted md:grid-cols-3">
        <li>
          <span className="text-fg">Mobile:</span> full-width cards, 16px gutters (<code className="num">Container</code> px-4), touch targets ≥ 44px.
        </li>
        <li>
          <span className="text-fg">Tablet:</span> two-up cards (4 + 4), forms max ~640px.
        </li>
        <li>
          <span className="text-fg">Desktop:</span> 3-up cards (4 + 4 + 4) or 8 + 4 content/sidebar. Max width 1440px.
        </li>
      </ul>
    </div>
  );
}
