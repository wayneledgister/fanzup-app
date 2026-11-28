/**
 * CR-007 (FR-MKT-021): what a marketplace page shows when the API refuses the caller because of the closed-beta
 * audience: signed out (401) → sign in and come back; outside the audience (403 `invite_only`) → the invite-only note.
 */
import { Navigate, useLocation } from "react-router";
import { Lock } from "lucide-react";
import { Callout, Container } from "@/components/brand";
import { ApiError } from "@/lib/api";
import { MKT_INVITE_ONLY } from "@fanzup/shared/marketplace";

export const isClosedBeta = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.code === "invite_only");

export function ClosedBeta({ error }: { error: unknown }) {
  const loc = useLocation();
  if (error instanceof ApiError && error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return (
    <Container size="md" className="py-16">
      <Callout tone="info" icon={<Lock />} title="The services marketplace is in a closed beta">{MKT_INVITE_ONLY}</Callout>
    </Container>
  );
}
