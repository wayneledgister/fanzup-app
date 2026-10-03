import { Construction, Loader2, Compass } from "lucide-react";
import { Link } from "react-router";
import { Button, Container, EmptyState } from "@/components/brand";

/** Temporary page body for routes not yet built. */
export function PagePlaceholder({ title, route, source }: { title: string; route: string; source: string }) {
  return (
    <Container size="md" className="py-16">
      <EmptyState icon={<Construction />} title={title}>
        <span className="num text-xs">{route}</span>
        <br />
        Built from: {source}
      </EmptyState>
    </Container>
  );
}

export function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted" role="status">
      <Loader2 className="size-6 animate-spin text-gold" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function NotFound() {
  return (
    <Container size="md" className="py-24">
      <EmptyState icon={<Compass />} title="This page doesn't exist" action={<Button asChild><Link to="/">Back to FanZuP</Link></Button>}>
        The link may be broken or the page may have moved.
      </EmptyState>
    </Container>
  );
}
