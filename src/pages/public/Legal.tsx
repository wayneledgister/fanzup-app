import { FileText } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button, Container, EmptyState, PageHeader } from "@/components/brand";

/** Source: new. Terms and privacy documents are being drafted with counsel; no placeholder legal text is published. */
const DOCS: Record<string, string> = { terms: "Terms of Service", privacy: "Privacy Policy", "campaign-terms": "Campaign Terms for Backers" };

export default function Legal() {
  const { doc = "" } = useParams();
  const title = DOCS[doc] ?? "Legal";
  return (
    <Container size="md" className="py-16">
      <PageHeader eyebrow="Legal" title={title} />
      <EmptyState icon={<FileText />} title="This document is being finalized" action={<Button asChild variant="secondary"><Link to="/support">Contact us</Link></Button>}>
        We're finalizing our {title.toLowerCase()} with counsel before launch. It will be published here before any account can be created.
      </EmptyState>
    </Container>
  );
}
