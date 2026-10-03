import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, CalendarClock, CheckCircle2, FileText, Globe, Headphones, Image as ImageIcon, Lock, Save, Send, Users, Video, type LucideIcon } from "lucide-react";
import { Button, Callout, Card, ChoiceCard, Container, Field, PageHeader, ProgressBar, Select, TextArea, TextInput } from "@/components/brand";
import { FileDrop, formatDay } from "@/components/creator/ui";
import { creatorCampaigns } from "@/components/creator/data";
import { cn } from "@/lib/utils";

/**
 * Source: Fan Profile Setup UploadContent.tsx.
 * Doc-driven changes: access levels "Pool Holders Only / Unit holders only" replaced with "Backers of a campaign"
 * (exclusives are unlocked by subscription or campaign perk, never by units — CONSOLIDATION /backstage).
 * "Followers only" merged into Public. Upload progress + success state added.
 */
type Kind = "audio" | "video" | "image" | "document";
type Vis = "public" | "subscribers" | "backers";
type Publish = "now" | "schedule" | "draft";

const KINDS: { value: Kind; label: string; desc: string; accept: string; formats: string; icon: LucideIcon }[] = [
  { value: "audio", label: "Audio", desc: "Tracks, demos, voice notes", accept: "audio/*", formats: "MP3, WAV or FLAC", icon: Headphones },
  { value: "video", label: "Video", desc: "Clips, diaries, stream replays", accept: "video/*", formats: "MP4 or MOV", icon: Video },
  { value: "image", label: "Image", desc: "Photos, artwork, posters", accept: "image/*", formats: "JPG, PNG or GIF", icon: ImageIcon },
  { value: "document", label: "Document", desc: "Lyrics, liner notes, PDFs", accept: ".pdf,.txt,.doc,.docx", formats: "PDF, DOC or TXT", icon: FileText },
];

const VIS: { value: Vis; label: string; desc: string; icon: LucideIcon }[] = [
  { value: "public", label: "Public", desc: "Anyone on FanZuP, including people who don't follow you yet.", icon: Globe },
  { value: "subscribers", label: "Subscribers", desc: "Only fans with an active subscription to you.", icon: Users },
  { value: "backers", label: "Backers of a campaign", desc: "Only fans who backed the campaign you choose.", icon: Lock },
];

export default function Upload() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>("video");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [tags, setTags] = useState("");
  const [vis, setVis] = useState<Vis>("subscribers");
  const [campaign, setCampaign] = useState("");
  const [publish, setPublish] = useState<Publish>("now");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<null | Publish>(null);

  const eligible = creatorCampaigns.filter((c) => c.backers > 0 && c.status !== "refunded");
  const k = KINDS.find((x) => x.value === kind)!;

  // Simulated upload progress once a file is picked.
  useEffect(() => {
    if (!file) return setProgress(0);
    setProgress(8);
    const t = window.setInterval(() => setProgress((p) => (p >= 100 ? 100 : Math.min(100, p + 23))), 350);
    return () => window.clearInterval(t);
  }, [file]);

  const submit = (mode: Publish) => {
    const e: Record<string, string> = {};
    if (!file) e.file = "Add a file to upload.";
    else if (progress < 100) e.file = "Wait for the upload to finish.";
    if (!title.trim()) e.title = "Give it a title fans will recognize.";
    if (vis === "backers" && !campaign) e.campaign = "Choose which campaign's backers can see this.";
    if (mode === "schedule") {
      if (!date) e.date = "Pick a date.";
      else if (date <= "2026-10-02") e.date = "Pick a date after today.";
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setDone(mode);
  };

  if (done) {
    const msg = { now: "It's live", schedule: "It's scheduled", draft: "Draft saved" }[done];
    return (
      <Container size="md" className="py-16">
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <CheckCircle2 className="size-12 text-success" />
          <h1 className="text-3xl font-bold">{msg}</h1>
          <p className="max-w-md text-muted">
            {done === "now" && <>“{title}” is published to {vis === "public" ? "everyone" : vis === "subscribers" ? "your subscribers" : "your backers"}. We'll notify them.</>}
            {done === "schedule" && <>“{title}” goes out on {formatDay(date)} at <span className="num">{time}</span>.</>}
            {done === "draft" && <>Only you can see “{title}”. Publish it from your content library whenever you're ready.</>}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => navigate("/creator/content")}>Go to content library</Button>
            <Button variant="secondary" onClick={() => { setDone(null); setFile(null); setTitle(""); setDesc(""); setTags(""); }}>
              Upload another
            </Button>
          </div>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" className="py-8 sm:py-10">
      <Link to="/creator/content" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Content library
      </Link>
      <PageHeader eyebrow="Upload" title="Upload new content" description="Share something with your fans — and decide exactly who gets to see it." />

      <form className="flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); submit(publish); }} noValidate>
        <Card className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold">1. What are you sharing?</h2>
          <div role="radiogroup" aria-label="Content type" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {KINDS.map((o) => (
              <ChoiceCard key={o.value} selected={kind === o.value} onSelect={() => { setKind(o.value); setFile(null); }} className="p-4">
                <o.icon className={cn("mb-3 size-5", kind === o.value ? "text-gold" : "text-muted")} />
                <span className="block text-sm font-semibold text-fg">{o.label}</span>
                <span className="block text-xs text-muted">{o.desc}</span>
              </ChoiceCard>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <FileDrop accept={k.accept} hint={k.formats} file={file} onFile={(f) => { setFile(f); setErrors((e) => ({ ...e, file: "" })); }} error={errors.file} />
            {file && (
              <div className="flex items-center gap-3" aria-live="polite">
                <ProgressBar value={progress} max={100} tone={progress >= 100 ? "success" : "info"} label="Upload progress" />
                <span className="num w-24 shrink-0 text-right text-xs text-muted">{progress >= 100 ? "Uploaded" : `${progress}%`}</span>
              </div>
            )}
          </div>
        </Card>

        <Card className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold">2. Details</h2>
          <Field label="Title" htmlFor="title" error={errors.title}>
            <TextInput id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tour diary #4 — booking the van" aria-invalid={!!errors.title} maxLength={120} />
          </Field>
          <Field label="Description" htmlFor="desc" optional>
            <TextArea id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What should fans know before they press play?" />
          </Field>
          <Field label="Tags" htmlFor="tags" optional hint="Separate with commas, e.g. rehearsal, horns, tour">
            <TextInput id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        </Card>

        <Card className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold">3. Who can see it</h2>
          <div role="radiogroup" aria-label="Visibility" className="flex flex-col gap-3">
            {VIS.map((o) => (
              <ChoiceCard key={o.value} selected={vis === o.value} onSelect={() => setVis(o.value)} className="flex items-start gap-4 p-4">
                <o.icon className={cn("mt-0.5 size-5 shrink-0", vis === o.value ? "text-gold" : "text-muted")} />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-fg">{o.label}</span>
                  <span className="text-sm text-muted">{o.desc}</span>
                </span>
              </ChoiceCard>
            ))}
          </div>
          {vis === "backers" && (
            <Field label="Campaign" htmlFor="camp" error={errors.campaign}>
              <Select id="camp" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-invalid={!!errors.campaign}>
                <option value="">Choose a campaign</option>
                {eligible.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.backers} backers)
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </Card>

        <Card className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold">4. When</h2>
          <div role="radiogroup" aria-label="Publishing" className="grid gap-3 sm:grid-cols-3">
            {([
              ["now", "Publish now", Send],
              ["schedule", "Schedule", CalendarClock],
              ["draft", "Save as draft", Save],
            ] as const).map(([v, l, Icon]) => (
              <ChoiceCard key={v} selected={publish === v} onSelect={() => setPublish(v)} className="flex items-center gap-3 p-4">
                <Icon className={cn("size-5", publish === v ? "text-gold" : "text-muted")} />
                <span className="text-sm font-semibold text-fg">{l}</span>
              </ChoiceCard>
            ))}
          </div>
          {publish === "schedule" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor="date" error={errors.date}>
                <TextInput id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
              </Field>
              <Field label="Time" htmlFor="time" hint="Your local time (Eastern)">
                <TextInput id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>
          )}
        </Card>

        {Object.values(errors).some(Boolean) && (
          <Callout tone="error" title="A few things need fixing">
            Check the highlighted fields above.
          </Callout>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => navigate("/creator/content")}>
            Cancel
          </Button>
          <Button type="submit" size="lg">
            {publish === "now" ? "Publish" : publish === "schedule" ? "Schedule post" : "Save draft"}
          </Button>
        </div>
      </form>
    </Container>
  );
}
