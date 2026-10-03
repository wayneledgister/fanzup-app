/** ID options for the identity-partner capture steps (reference screens; production uses the partner's hosted SDK, PRD 01 §9.7). */
import { BookOpen, CreditCard, IdCard } from "lucide-react";

export const ID_TYPES = [
  { id: "drivers_license", label: "Driver's license", detail: "Issued by a US state. Front and back.", icon: CreditCard, sides: 2 },
  { id: "passport", label: "Passport", detail: "US or international. Photo page only.", icon: BookOpen, sides: 1 },
  { id: "state_id", label: "State ID card", detail: "Government-issued photo ID. Front and back.", icon: IdCard, sides: 2 },
] as const;
export type IdTypeId = (typeof ID_TYPES)[number]["id"];

export function idTypeFrom(search: URLSearchParams) {
  return ID_TYPES.find((t) => t.id === search.get("type")) ?? ID_TYPES[0];
}
