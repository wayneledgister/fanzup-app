import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, CalendarClock, CheckCircle2, KeyRound } from "lucide-react";
import { ArtistArt, Button, Card, Container, Field, KeyValue, TextInput } from "@/components/brand";
import { CopyCode } from "@/components/fan/kit";
import { formatSessionTime, sessionByCode, sessionById } from "@/components/fan/live-data";
import { artistById } from "@/lib/mock";
import { POLICY } from "@/config/policy";

/**
 * Source: FPS streaming/AccessCodeEntry.tsx.
 * Doc-driven: wireframe's two stacked panels kept as a real flow — purchase confirmation appears only when arriving
 * from a purchase (?session=&code=); code entry validates format and shows a human error for unknown codes.
 */
const FORMAT = /^FZP-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export default function AccessCode() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const purchased = params.get("session") ? sessionById(params.get("session")!) : undefined;
  const purchasedCode = purchased ? params.get("code") ?? "" : "";

  const [code, setCode] = useState(purchasedCode);
  const [error, setError] = useState<string | null>(null);

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return setError("Enter the code from your confirmation email.");
    if (!FORMAT.test(c)) return setError("Codes look like FZP-XXXX-XXXX. Check for a missing dash or letter.");
    const s = purchased && c === purchasedCode.toUpperCase() ? purchased : sessionByCode(c);
    if (!s) return setError("We couldn't find that code. Check your confirmation email, or buy access from Live sessions.");
    setError(null);
    navigate(`/live/${s.id}?pass=1`);
  };

  return (
    <Container size="sm" className="py-8 sm:py-12">
      <Link to="/live" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Live sessions
      </Link>

      {purchased && <Confirmation sessionId={purchased.id} code={purchasedCode} />}

      <Card className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-1 size-5 shrink-0 text-gold" />
          <div>
            <h1 className="text-2xl font-bold">{purchased ? "Ready when you are" : "Enter your access code"}</h1>
            <p className="text-sm text-muted">Find it in your confirmation email or in Payments.</p>
          </div>
        </div>
        <form onSubmit={join} className="flex flex-col gap-4" noValidate>
          <Field label="Access code" htmlFor="code" error={error}>
            <TextInput
              id="code"
              value={code}
              onChange={(e) => (setCode(e.target.value.toUpperCase()), setError(null))}
              placeholder="FZP-XXXX-XXXX"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              className="num h-12 text-base tracking-wider"
              aria-invalid={!!error}
            />
          </Field>
          <Button type="submit" size="lg" block>
            Join stream
          </Button>
        </form>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Each code works for one session, on one device at a time.</li>
          <li>The player opens at the scheduled start time.</li>
          <li>Replays stay available to code holders for {POLICY.streaming.replayHours} hours.</li>
        </ul>
      </Card>
    </Container>
  );
}

function Confirmation({ sessionId, code }: { sessionId: string; code: string }) {
  const s = sessionById(sessionId)!;
  const a = artistById(s.artistId);
  return (
    <Card className="mb-6 flex flex-col gap-5 border-success/30">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="size-6 text-success" />
        <div>
          <h2 className="text-lg font-semibold">Purchase complete</h2>
          <p className="text-sm text-muted">We've emailed your code and receipt.</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ArtistArt seed={`live-${s.id}`} label={a.name} className="size-14 shrink-0" rounded="md" />
        <div className="min-w-0">
          <p className="truncate font-medium">{s.title}</p>
          <p className="text-sm text-muted">{a.name}</p>
        </div>
      </div>
      <div className="rounded-md border border-line bg-surface-2 px-4 py-1">
        <KeyValue
          k={
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-4" /> Starts
            </span>
          }
          v={<span className="num">{formatSessionTime(s.startsAt)}</span>}
        />
      </div>
      <CopyCode code={code} label="Access code" />
    </Card>
  );
}
