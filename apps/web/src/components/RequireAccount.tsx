/**
 * Route guard (FR-ID-005 guards; FR-BCK-002 full account first). Signed out → sign up (or log in) and come back;
 * signed in but unverified → verify email and come back. The UI guard is a convenience: the API enforces both.
 */
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { CircleAlert } from "lucide-react";
import { Callout, Container } from "@/components/brand";
import { RouteFallback } from "@/components/PagePlaceholder";
import { useSession } from "@/lib/session";

export function RequireAccount({ children, verified = true, entry = "login" }: { children: ReactNode; verified?: boolean; entry?: "login" | "signup" }) {
  const s = useSession();
  const loc = useLocation();
  const next = encodeURIComponent(loc.pathname + loc.search);
  if (!s.configured) {
    return (
      <Container size="md" className="py-16">
        <Callout tone="warning" icon={<CircleAlert />} title="Sign-in isn't configured here">
          This build has no Supabase project connected (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), so accounts can't be used.
        </Callout>
      </Container>
    );
  }
  if (s.loading) return <RouteFallback />;
  if (!s.session) return <Navigate to={`/${entry}?next=${next}`} replace />;
  if (verified && !s.emailVerified) return <Navigate to={`/verify-email?next=${next}${s.email ? `&email=${encodeURIComponent(s.email)}` : ""}`} replace />;
  return <>{children}</>;
}
