import { useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import {
  Bell, CalendarDays, Compass, Gem, Home, LayoutDashboard, LineChart, Menu, Package, Radio, Receipt, Settings, ShieldCheck,
  Sparkles, Ticket, Upload, User, Users, Wallet, X, Megaphone, Landmark, Vote, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFlag, setFlag, allFlags } from "@/lib/flags";
import { Button, Logo, Container } from "@/components/brand";

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; flag?: "layer2" | "postBeta"; end?: boolean };

/* ── Public (marketing + discovery) ─────────────────────── */

export function PublicShell() {
  const [open, setOpen] = useState(false);
  const links = [
    { to: "/explore", label: "Discover" },
    { to: "/#how-it-works", label: "How it works" },
    { to: "/for-artists", label: "For artists" },
    { to: "/fees", label: "Fees" },
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollRestoration />
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <Container size="xl" className="flex h-16 items-center justify-between gap-6">
          <Link to="/" aria-label="FanZuP home">
            <Logo size="sm" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">Join FanZuP</Link>
            </Button>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
            {open ? <X /> : <Menu />}
          </Button>
        </Container>
        {open && (
          <nav className="border-t border-line bg-canvas px-4 py-4 md:hidden" aria-label="Mobile">
            <div className="flex flex-col gap-1">
              {links.map((l) => (
                <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-fg hover:bg-surface">
                  {l.label}
                </Link>
              ))}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button asChild variant="secondary">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild>
                  <Link to="/signup">Join</Link>
                </Button>
              </div>
            </div>
          </nav>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas">
      <Container size="xl" className="grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-4">
          <Logo size="sm" />
          <p className="max-w-xs text-sm text-muted">Fund the culture. Own the future.</p>
        </div>
        {[
          { h: "Fans", l: [["Discover", "/explore"], ["Tickets", "/tickets"], ["Merch", "/merch"]] },
          { h: "Artists", l: [["Start a campaign", "/for-artists"], ["Creator tiers", "/for-artists#tiers"], ["Fees", "/fees"]] },
          { h: "Company", l: [["Trust & safety", "/trust"], ["Terms", "/legal/terms"], ["Privacy", "/legal/privacy"]] },
        ].map((col) => (
          <div key={col.h} className="flex flex-col gap-3">
            <span className="eyebrow">{col.h}</span>
            {col.l.map(([label, to]) => (
              <Link key={to} to={to} className="text-sm text-muted hover:text-fg">
                {label}
              </Link>
            ))}
          </div>
        ))}
      </Container>
      <Container size="xl" className="border-t border-line py-6">
        <p className="text-xs leading-relaxed text-muted">
          © 2026 FanZuP LLC. Campaign backers receive perks, not securities. Any securities offerings are made only through a
          FINRA-registered intermediary under Regulation Crowdfunding, are speculative and illiquid, and may result in total loss.
        </p>
      </Container>
    </footer>
  );
}

/* ── Centered card shell (auth) ─────────────────────────── */

export function AuthShell() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(212_175_55/0.10),transparent)]" />
      <header className="relative flex h-16 items-center px-4 sm:px-8">
        <Link to="/" aria-label="FanZuP home">
          <Logo size="sm" />
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/* ── Onboarding / wizard shell ──────────────────────────── */

export function WizardShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollRestoration />
      <header className="flex h-16 items-center justify-between border-b border-line px-4 sm:px-8">
        <Link to="/" aria-label="FanZuP home">
          <Logo size="sm" />
        </Link>
        <Link to="/home" className="text-sm text-muted hover:text-fg">
          Save &amp; exit
        </Link>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-20 pt-8 sm:pt-12">
        <div className="w-full max-w-2xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/* ── Signed-in app shells ───────────────────────────────── */

const FAN_NAV: NavItem[] = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/explore", label: "Discover", icon: Compass },
  { to: "/backed", label: "Backed & perks", icon: Gem },
  { to: "/tickets", label: "Tickets", icon: Ticket },
  { to: "/merch", label: "Merch", icon: Package },
  { to: "/backstage", label: "Backstage", icon: Sparkles },
  { to: "/live", label: "Live", icon: Radio },
  { to: "/portfolio", label: "Portfolio", icon: LineChart, flag: "layer2" },
  { to: "/governance", label: "Holder votes", icon: Vote, flag: "postBeta" },
];
const FAN_SECONDARY: NavItem[] = [
  { to: "/profile", label: "Profile", icon: User },
  { to: "/settings", label: "Settings", icon: Settings, end: true },
];

const CREATOR_NAV: NavItem[] = [
  { to: "/creator", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/creator/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/creator/revenue", label: "Revenue", icon: LineChart },
  { to: "/creator/content", label: "Content", icon: Upload },
  { to: "/creator/events", label: "Events", icon: CalendarDays },
  { to: "/creator/streaming", label: "Live", icon: Radio },
  { to: "/creator/payouts", label: "Payouts", icon: Landmark },
  { to: "/creator/tax", label: "Tax documents", icon: Receipt },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Queues", icon: ClipboardList, end: true },
  { to: "/admin/review/under-review", label: "Campaign review", icon: ShieldCheck },
  { to: "/admin/kyc", label: "Identity review", icon: Users },
];

function SideNav({ items, secondary, onNavigate }: { items: NavItem[]; secondary?: NavItem[]; onNavigate?: () => void }) {
  const layer2 = useFlag("layer2");
  const postBeta = useFlag("postBeta");
  const visible = (i: NavItem) => !i.flag || (i.flag === "layer2" ? layer2 : postBeta);
  const link = (i: NavItem) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
          isActive ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface hover:text-fg",
        )
      }
    >
      {({ isActive }) => (
        <>
          <i.icon className={cn("size-5", isActive ? "text-gold" : "text-muted group-hover:text-fg")} />
          {i.label}
        </>
      )}
    </NavLink>
  );
  return (
    <nav className="flex flex-1 flex-col gap-1" aria-label="App">
      {items.filter(visible).map(link)}
      {secondary && <div className="mt-auto flex flex-col gap-1 border-t border-line pt-4">{secondary.filter(visible).map(link)}</div>}
    </nav>
  );
}

function AppFrame({ items, secondary, mode }: { items: NavItem[]; secondary?: NavItem[]; mode: "fan" | "creator" | "admin" }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const modeLabel = { fan: "Fan", creator: "Creator", admin: "Compliance" }[mode];
  const switchTo = mode === "fan" ? { to: "/creator", label: "Switch to creator" } : { to: "/home", label: "Switch to fan" };
  const mobileTabs = items.filter((i) => !i.flag).slice(0, 4);
  return (
    <div className="flex min-h-dvh">
      <ScrollRestoration />
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-line bg-canvas px-4 py-5 lg:flex">
        <Link to={mode === "creator" ? "/creator" : mode === "admin" ? "/admin" : "/home"} className="px-2" aria-label="FanZuP home">
          <Logo size="sm" />
        </Link>
        <span className="eyebrow px-3">{modeLabel}</span>
        <SideNav items={items} secondary={secondary} />
        <Link to={switchTo.to} className="rounded-md border border-line px-3 py-2 text-center text-xs text-muted hover:text-fg">
          {switchTo.label}
        </Link>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 border-r border-line bg-canvas px-4 py-5">
            <Logo size="sm" className="px-2" />
            <SideNav items={items} secondary={secondary} onNavigate={() => setOpen(false)} />
            <Link to={switchTo.to} onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-2 text-center text-xs text-muted">
              {switchTo.label}
            </Link>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
              <Menu />
            </Button>
            <Link to="/" className="lg:hidden" aria-label="FanZuP home">
              <Logo size="sm" showWordmark={false} />
            </Link>
          </div>
          <div className="flex items-center gap-1">
            {mode === "fan" && (
              <Button asChild variant="ghost" size="icon" aria-label="Payment methods">
                <Link to="/settings/payments">
                  <Wallet />
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell />
            </Button>
            <Link to={mode === "fan" ? "/profile" : "/creator"} className="ml-1 flex size-9 items-center justify-center rounded-full border border-line bg-surface-2 text-xs font-semibold text-gold" aria-label="Account">
              {mode === "fan" ? "JP" : "NR"}
            </Link>
          </div>
        </header>
        <main key={pathname} className="flex-1 pb-24 lg:pb-12">
          <Outlet />
        </main>
        {/* Mobile bottom tabs */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-canvas/95 backdrop-blur-md lg:hidden" aria-label="Tabs">
          {mobileTabs.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn("flex flex-col items-center gap-1 py-2.5 text-[11px]", isActive ? "text-gold" : "text-muted")}>
              <i.icon className="size-5" />
              {i.label.split(" ")[0]}
            </NavLink>
          ))}
        </nav>
      </div>
      <DevFlagPanel />
    </div>
  );
}

export const FanShell = () => <AppFrame items={FAN_NAV} secondary={FAN_SECONDARY} mode="fan" />;
export const CreatorShell = () => <AppFrame items={CREATOR_NAV} mode="creator" />;
export const AdminShell = () => <AppFrame items={ADMIN_NAV} mode="admin" />;

/** Dev-only flag toggles for design review (hidden in production builds). */
function DevFlagPanel() {
  const layer2 = useFlag("layer2");
  const postBeta = useFlag("postBeta");
  const [open, setOpen] = useState(false);
  if (!import.meta.env.DEV) return null;
  const vals = { layer2, postBeta };
  return (
    <div className="fixed bottom-20 right-4 z-50 lg:bottom-4">
      {open ? (
        <div className="flex w-56 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Feature flags</span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          {allFlags.map((f) => (
            <label key={f} className="flex items-center justify-between text-sm">
              <span className="num">{f}</span>
              <input type="checkbox" checked={vals[f]} onChange={(e) => setFlag(f, e.target.checked)} className="accent-[#D4AF37]" />
            </label>
          ))}
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted shadow-lg hover:text-fg">
          Flags
        </button>
      )}
    </div>
  );
}
