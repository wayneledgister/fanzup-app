/** Identity-document definitions shared by the investor KYC steps. */
import { BookOpen, Car, CreditCard } from "lucide-react";
import type { ReactNode } from "react";

export type DocId = "passport" | "drivers_license" | "state_id";

export const DOCS: Record<DocId, { label: string; description: string; sides: 1 | 2; icon: ReactNode }> = {
  drivers_license: { label: "Driver's license", description: "Issued by a US state or territory", sides: 2, icon: <Car /> },
  state_id: { label: "State ID card", description: "Non-driver photo ID issued by a US state", sides: 2, icon: <CreditCard /> },
  passport: { label: "Passport", description: "Photo page of a valid passport", sides: 1, icon: <BookOpen /> },
};

export function parseDoc(v: string | null): DocId {
  return v && v in DOCS ? (v as DocId) : "drivers_license";
}
