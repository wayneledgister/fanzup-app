import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CircleAlert, PartyPopper } from "lucide-react";
import { Button, Callout, Card, Container, PageHeader } from "@/components/brand";
import { RequireAccount } from "@/components/RequireAccount";
import { api, ApiError } from "@/lib/api";
import { refreshMarketplaceAccess } from "@/lib/marketplace";
import { MKT_VETTING_NOTE } from "@fanzup/shared/marketplace";

/**
 * Source: (new) CR-007, FR-MKT-023/029. An invited provider or artist opens their link, signs in (RequireAccount sends
 * them to log in and back), and the invite is redeemed for the account whose email it was sent to.
 *
 * The code travels in the URL fragment (`/services/join#code=…`), which browsers never send to a server, so it can't
 * land in hosting or proxy logs (NFR-MKT-08). It's kept in localStorage for a day, so it survives the sign-in
 * redirect (which drops the fragment), email verification in a new tab, and switching accounts after a mismatch. It's
 * forgotten once the invite is redeemed or the API says it's no longer valid. `?code=` also works.
 */
const KEY = "fanzup.mkt.join";
const KEEP_MS = 24 * 3_600_000;
function stashCode() {
  try {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("code");
    const fromQuery = new URLSearchParams(window.location.search).get("code");
    const code = fromHash ?? fromQuery;
    if (code) {
      localStorage.setItem(KEY, JSON.stringify({ code, until: Date.now() + KEEP_MS }));
      if (fromHash) history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  } catch {
    /* storage unavailable: the code is read from the URL below */
  }
}
function readCode(fallback: string | null): string {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as { code?: string; until?: number }) : null;
    if (v?.code && (v.until ?? 0) > Date.now()) return v.code;
  } catch {
    /* fall through */
  }
  return fallback ?? "";
}
function forgetCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

export default function JoinMarketplacePage() {
  if (typeof window !== "undefined") stashCode();
  return (
    <RequireAccount>
      <Join />
    </RequireAccount>
  );
}

function Join() {
  const [params] = useSearchParams();
  const [code] = useState(() => readCode(params.get("code")));
  const nav = useNavigate();
  const [state, setState] = useState<{ kind: "working" } | { kind: "joined"; as: "provider" | "artist" } | { kind: "error"; title: string; text: string }>({ kind: "working" });
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!code) {
      setState({ kind: "error", title: "This link is missing its invite code", text: "Open the invite link again, exactly as you received it." });
      return;
    }
    api.joinMarketplace(code)
      .then((r) => {
        forgetCode();
        refreshMarketplaceAccess();
        setState({ kind: "joined", as: r.member.kind });
      })
      .catch((e) => {
        const err = e instanceof ApiError ? e : null;
        if (err?.code === "invite_email_mismatch") {
          setState({ kind: "error", title: "This invite is for a different account", text: "Sign out, then sign in or create an account with the email address the invite was sent to." });
        } else if (err?.code === "invite_invalid") {
          forgetCode();
          setState({ kind: "error", title: "This invite link doesn't work any more", text: "It may have been used already, revoked or expired. Ask the FanZuP team for a new one." });
        } else {
          setState({ kind: "error", title: "We couldn't use this invite", text: err?.message ?? "Something went wrong. Try again in a moment." });
        }
      });
  }, [code]);

  return (
    <Container size="sm" className="flex flex-col gap-6 py-12">
      <PageHeader eyebrow="Services marketplace · closed beta" title="Join the FanZuP services beta" />
      {state.kind === "working" && <div className="h-32 animate-pulse rounded-lg border border-line bg-surface" aria-busy="true" aria-label="Checking your invite" />}
      {state.kind === "error" && (
        <Callout tone="warning" icon={<CircleAlert />} title={state.title}>
          {state.text}
          <p className="mt-3"><Link className="text-gold underline-offset-4 hover:underline" to="/support">Contact support</Link></p>
        </Callout>
      )}
      {state.kind === "joined" && (
        <Card className="flex flex-col gap-4" data-testid="join-done">
          <p className="flex items-center gap-2 text-lg font-semibold"><PartyPopper className="size-5 text-gold" /> You're in</p>
          {state.as === "provider" ? (
            <>
              <p className="text-sm text-muted">Set up your provider profile and add your services. {MKT_VETTING_NOTE}</p>
              <Button onClick={() => nav("/provider")}>Set up my provider profile</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Find producers, engineers, designers and more, and send them a request.</p>
              <Button onClick={() => nav("/services")}>Browse services</Button>
            </>
          )}
        </Card>
      )}
    </Container>
  );
}
