import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bell, ChevronRight, CreditCard, FileText, KeyRound, Link2, Lock, Music, ShieldCheck, Smartphone, Trash2, UserRound } from "lucide-react";
import { Badge, Button, Callout, Card, Container, Field, IconChip, PageHeader, TextInput } from "@/components/brand";
import { Modal, Toggle, useToast } from "@/components/fan/kit";
import { fan } from "@/lib/mock";
import { POLICY } from "@/config/policy";

/**
 * Source: routes.tsx stub AC — notifications, privacy, connected accounts, security, danger zone.
 * Doc-driven: MFA per PRD 01 FR-IDENTITY; links out to Payments (no stored balance) and Tax documents.
 * Connected accounts are fan-side listening/social only; no wallet or crypto connections.
 */

const SECTIONS = [
  { id: "notifications", label: "Notifications", icon: <Bell /> },
  { id: "privacy", label: "Privacy", icon: <Lock /> },
  { id: "connected", label: "Connected accounts", icon: <Link2 /> },
  { id: "security", label: "Security", icon: <ShieldCheck /> },
  { id: "billing", label: "Payments & tax", icon: <CreditCard /> },
  { id: "danger", label: "Delete account", icon: <Trash2 /> },
];

export default function Settings() {
  const toast = useToast();
  const [notif, setNotif] = useState({ updates: true, drops: true, events: true, perks: true, live: false, marketing: false });
  const [privacy, setPrivacy] = useState({ publicProfile: true, showBacked: true, showFollowing: true, searchable: true });
  const [accounts, setAccounts] = useState<Record<string, string | null>>({ Spotify: "jordanpierce", "Apple Music": null, Instagram: "@jordanp.lr" });
  const [mfa, setMfa] = useState(true);
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  return (
    <Container size="lg" className="py-8 sm:py-10">
      <PageHeader eyebrow="Account" title="Settings" description={`Signed in as ${fan.name} (${fan.handle}).`} />

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-24 flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface hover:text-fg [&_svg]:size-4">
                  {s.icon}
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <Section id="notifications" icon={<Bell />} title="Notifications" description="Choose what we email and push to you.">
            <div className="divide-y divide-line">
              <Toggle id="n-updates" checked={notif.updates} onChange={(v) => setNotif({ ...notif, updates: v })} label="Campaign updates" description="Progress, milestones and news from campaigns you back." />
              <Toggle id="n-drops" checked={notif.drops} onChange={(v) => setNotif({ ...notif, drops: v })} label="New drops" description="Music, merch and backstage posts from artists you follow." />
              <Toggle id="n-events" checked={notif.events} onChange={(v) => setNotif({ ...notif, events: v })} label="Shows and presales" description="New dates and backer presales near you." />
              <Toggle id="n-perks" checked={notif.perks} onChange={(v) => setNotif({ ...notif, perks: v })} label="Perk delivery" description="Shipping, codes and downloads for perks you've earned." />
              <Toggle id="n-live" checked={notif.live} onChange={(v) => setNotif({ ...notif, live: v })} label="Going live" description="When an artist you follow starts a live session." />
              <Toggle id="n-marketing" checked={notif.marketing} onChange={(v) => setNotif({ ...notif, marketing: v })} label="FanZuP news" description="Product updates and occasional announcements." />
            </div>
          </Section>

          <Section id="privacy" icon={<Lock />} title="Privacy" description="Control what other fans and artists can see.">
            <div className="divide-y divide-line">
              <Toggle id="p-public" checked={privacy.publicProfile} onChange={(v) => setPrivacy({ ...privacy, publicProfile: v })} label="Public profile" description="Anyone on FanZuP can view your profile and badges." />
              <Toggle id="p-backed" checked={privacy.showBacked} onChange={(v) => setPrivacy({ ...privacy, showBacked: v })} label="Show campaigns I've backed" description="Amounts are never shown, only campaign names." disabled={!privacy.publicProfile} />
              <Toggle id="p-following" checked={privacy.showFollowing} onChange={(v) => setPrivacy({ ...privacy, showFollowing: v })} label="Show who I follow" disabled={!privacy.publicProfile} />
              <Toggle id="p-search" checked={privacy.searchable} onChange={(v) => setPrivacy({ ...privacy, searchable: v })} label="Let artists find me by email" description="So artists can invite you to presales and listening parties." />
            </div>
            <div className="mt-3">
              <Button variant="link" size="sm" onClick={() => toast.show("We'll email your data export within 48 hours.")}>
                Download my data
              </Button>
            </div>
          </Section>

          <Section id="connected" icon={<Link2 />} title="Connected accounts" description="Connect your listening and social accounts to get better artist suggestions.">
            <ul className="flex flex-col divide-y divide-line">
              {Object.entries(accounts).map(([name, handle]) => (
                <li key={name} className="flex items-center gap-4 py-3">
                  <IconChip tone={handle ? "success" : "muted"}>{name === "Instagram" ? <UserRound /> : <Music />}</IconChip>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="truncate text-xs text-muted">{handle ? `Connected as ${handle}` : "Not connected"}</p>
                  </div>
                  {handle ? (
                    <Button variant="ghost" size="sm" onClick={() => setAccounts({ ...accounts, [name]: null })}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => setAccounts({ ...accounts, [name]: fan.handle })}>
                      Connect
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">We only read your top artists and follows. We never post for you.</p>
          </Section>

          <Section id="security" icon={<ShieldCheck />} title="Security" description="Keep your account and payment methods safe.">
            <ul className="flex flex-col divide-y divide-line">
              <li className="flex items-center gap-4 py-3">
                <IconChip tone="muted">
                  <KeyRound />
                </IconChip>
                <div className="flex-1">
                  <p className="text-sm font-medium">Password</p>
                  <p className="text-xs text-muted">Last changed Jul 14, 2026</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setPwOpen(true)}>
                  Change
                </Button>
              </li>
              <li className="flex items-start gap-4 py-3">
                <IconChip tone={mfa ? "success" : "warning"}>
                  <Smartphone />
                </IconChip>
                <div className="flex-1">
                  <Toggle
                    id="mfa"
                    checked={mfa}
                    onChange={setMfa}
                    label={
                      <span className="flex items-center gap-2">
                        Two-step verification {mfa ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
                      </span>
                    }
                    description={mfa ? "Authenticator app ending ••42. Required for payments and payouts." : "Turn this on to protect your payment methods."}
                  />
                </div>
              </li>
            </ul>
            {!mfa && (
              <Callout tone="warning" title="Two-step verification is off" className="mt-3">
                Anyone with your password could sign in and make purchases. We strongly recommend turning it back on.
              </Callout>
            )}
          </Section>

          <Section id="billing" icon={<CreditCard />} title="Payments & tax">
            <ul className="flex flex-col divide-y divide-line">
              <LinkRow to="/settings/payments" icon={<CreditCard />} title="Payments" description="Payment methods, history and subscriptions." />
              <LinkRow to="/settings/tax" icon={<FileText />} title="Tax documents" description="Receipts and any tax forms for your account." />
            </ul>
          </Section>

          <section id="danger" className="scroll-mt-24 rounded-lg border border-error/40 bg-error/5 p-6">
            <h2 className="text-lg font-semibold">Delete account</h2>
            <p className="mt-1 text-sm text-muted">
              This permanently deletes your profile, follows, badges and backstage access. Perks still owed to you by live campaigns will be cancelled and
              refunded. Receipts we're required to keep are retained for tax purposes.
            </p>
            <Button variant="destructive" className="mt-4" onClick={() => setDelOpen(true)}>
              <Trash2 /> Delete my account
            </Button>
          </section>
        </div>
      </div>

      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} onDone={() => toast.show("Password updated.")} />
      <DeleteDialog open={delOpen} onClose={() => setDelOpen(false)} />
      {toast.node}
    </Container>
  );
}

function Section({ id, icon, title, description, children }: { id: string; icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-1 text-gold [&_svg]:size-5">{icon}</span>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function LinkRow({ to, icon, title, description }: { to: string; icon: ReactNode; title: string; description: string }) {
  return (
    <li>
      <Link to={to} className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 hover:bg-surface-2">
        <IconChip tone="muted">{icon}</IconChip>
        <div className="flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted">{description}</p>
        </div>
        <ChevronRight className="size-4 text-muted" />
      </Link>
    </li>
  );
}

function PasswordDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reset = () => (setCur(""), setNext(""), setConfirm(""), setErrors({}));
  const submit = () => {
    const e: Record<string, string> = {};
    if (!cur) e.cur = "Enter your current password.";
    if (next.length < 12) e.next = "Use at least 12 characters.";
    else if (!/[0-9]/.test(next) || !/[A-Za-z]/.test(next)) e.next = "Mix letters and numbers.";
    if (confirm !== next) e.confirm = "Passwords don't match.";
    setErrors(e);
    if (Object.keys(e).length === 0) {
      onClose();
      reset();
      onDone();
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && (onClose(), reset())}
      title="Change password"
      footer={
        <>
          <Button variant="secondary" onClick={() => (onClose(), reset())}>
            Cancel
          </Button>
          <Button onClick={submit}>Update password</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Current password" htmlFor="pw-cur" error={errors.cur}>
          <TextInput id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} aria-invalid={!!errors.cur} />
        </Field>
        <Field label="New password" htmlFor="pw-next" hint="At least 12 characters, with letters and numbers." error={errors.next}>
          <TextInput id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.next} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirm}>
          <TextInput id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
        </Field>
        <p className="text-xs text-muted">You'll stay signed in here and be signed out on other devices.</p>
      </div>
    </Modal>
  );
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const close = () => (onClose(), window.setTimeout(() => (setText(""), setDone(false)), 200));
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      title={done ? "Deletion scheduled" : "Delete your account?"}
      footer={
        done ? (
          <Button onClick={close}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Keep my account
            </Button>
            <Button variant="destructive" disabled={text !== "DELETE"} onClick={() => setDone(true)}>
              Delete permanently
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="text-sm text-muted">
          Your account will be deleted in <span className="num text-fg">{POLICY.account.deletionGraceDays}</span> days. Sign in before then to cancel. We've emailed you a confirmation.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Callout tone="error" title="This can't be undone">
            You'll lose your profile, badges, All-Access card and backstage access. Backings in live campaigns are cancelled and refunded from escrow.
          </Callout>
          <Field label={<>Type <span className="num">DELETE</span> to confirm</>} htmlFor="del-confirm">
            <TextInput id="del-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          </Field>
        </div>
      )}
    </Modal>
  );
}
