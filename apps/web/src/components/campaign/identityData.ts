/**
 * Demo identity-review (KYC / AML / sanctions) queue — PRD 01 FR-ADMIN, PRD 03.
 * Layer 1 verifies artists (campaign creators). Investor rows exist only behind `layer2`.
 * Personal data is masked in the UI; the verification vendor holds the source documents.
 */
import { hoursAgo, type AuditEntry } from "./reviewData";

export type CheckResult = "clear" | "review" | "fail" | "pending";
export type IdStatus = "needs-review" | "needs-info" | "escalated" | "approved" | "rejected";

export interface IdentityCase {
  id: string;
  name: string;
  role: "Artist" | "Investor";
  layer2?: boolean;
  submittedAt: string;
  status: IdStatus;
  risk: "Low" | "Medium" | "High";
  kyc: CheckResult;
  aml: CheckResult;
  sanctions: CheckResult;
  vendorRef: string;
  idType: string;
  issuing: string;
  docEnding: string;
  dobYear: number;
  liveness: number; // 0–100 match score from vendor
  addressMatch: boolean;
  pep: boolean;
  sanctionsHits: { list: string; name: string; score: number }[];
  reason?: string;
  audit: AuditEntry[];
}

const base = (id: string, name: string, h: number): AuditEntry[] => [
  { at: hoursAgo(h), actor: name, action: "Submitted identity verification" },
  { at: hoursAgo(h - 0.05), actor: "System", action: "Vendor checks returned", detail: `Reference ${id}` },
];

export const IDENTITY: IdentityCase[] = [
  {
    id: "IDV-30418", name: "June Ash", role: "Artist", submittedAt: hoursAgo(41), status: "needs-review", risk: "Medium",
    kyc: "review", aml: "clear", sanctions: "clear", vendorRef: "vk_8F2A19", idType: "Driver's license", issuing: "Tennessee, US", docEnding: "4471", dobYear: 1998,
    liveness: 71, addressMatch: false, pep: false, sanctionsHits: [], reason: "Selfie match below auto-approve threshold; address on ID differs from account.",
    audit: base("vk_8F2A19", "June Ash", 41),
  },
  {
    id: "IDV-30422", name: "Marisol Vega", role: "Artist", submittedAt: hoursAgo(30), status: "escalated", risk: "High",
    kyc: "clear", aml: "review", sanctions: "review", vendorRef: "vk_1C77D0", idType: "Passport", issuing: "United States", docEnding: "0932", dobYear: 1991,
    liveness: 96, addressMatch: true, pep: false, sanctionsHits: [{ list: "OFAC SDN", name: "Marisol Vega Ortiz", score: 82 }],
    reason: "Potential name match on a sanctions list. Date of birth not yet compared.",
    audit: [...base("vk_1C77D0", "Marisol Vega", 30), { at: hoursAgo(20), actor: "Priya Shah", action: "Escalated to AML lead", detail: "Possible sanctions match — needs second review" }],
  },
  {
    id: "IDV-30425", name: "DeShawn Price", role: "Artist", submittedAt: hoursAgo(9), status: "needs-review", risk: "Low",
    kyc: "review", aml: "clear", sanctions: "clear", vendorRef: "vk_77B3E4", idType: "State ID", issuing: "Georgia, US", docEnding: "1188", dobYear: 2001,
    liveness: 88, addressMatch: true, pep: false, sanctionsHits: [], reason: "Document glare on the back image; vendor couldn't read the barcode.",
    audit: base("vk_77B3E4", "DeShawn Price", 9),
  },
  {
    id: "IDV-30409", name: "Theo Banks", role: "Artist", submittedAt: hoursAgo(60), status: "needs-info", risk: "Medium",
    kyc: "pending", aml: "clear", sanctions: "clear", vendorRef: "vk_0A9C55", idType: "Passport", issuing: "United Kingdom", docEnding: "7720", dobYear: 1995,
    liveness: 0, addressMatch: false, pep: false, sanctionsHits: [], reason: "Asked for a proof of US address (utility bill or bank statement).",
    audit: [...base("vk_0A9C55", "Theo Banks", 60), { at: hoursAgo(48), actor: "Priya Shah", action: "Requested more information", detail: "Proof of US address" }],
  },
  {
    id: "IDV-30401", name: "Sol Amara", role: "Artist", submittedAt: hoursAgo(140), status: "approved", risk: "Low",
    kyc: "clear", aml: "clear", sanctions: "clear", vendorRef: "vk_5D1E02", idType: "Driver's license", issuing: "Arkansas, US", docEnding: "3305", dobYear: 1996,
    liveness: 97, addressMatch: true, pep: false, sanctionsHits: [],
    audit: [...base("vk_5D1E02", "Sol Amara", 140), { at: hoursAgo(120), actor: "Dana Okafor", action: "Approved" }],
  },
  {
    id: "IDV-30395", name: "Kyle Mercer", role: "Artist", submittedAt: hoursAgo(170), status: "rejected", risk: "High",
    kyc: "fail", aml: "clear", sanctions: "clear", vendorRef: "vk_3E8B41", idType: "Driver's license", issuing: "Florida, US", docEnding: "6619", dobYear: 1989,
    liveness: 34, addressMatch: false, pep: false, sanctionsHits: [], reason: "Document failed authenticity checks; selfie did not match.",
    audit: [...base("vk_3E8B41", "Kyle Mercer", 170), { at: hoursAgo(150), actor: "Priya Shah", action: "Rejected", detail: "Document authenticity failed. Artist may reapply in 30 days." }],
  },
  {
    id: "IDV-30430", name: "Jordan Pierce", role: "Investor", layer2: true, submittedAt: hoursAgo(5), status: "needs-review", risk: "Low",
    kyc: "clear", aml: "review", sanctions: "clear", vendorRef: "vk_9A0F13", idType: "Driver's license", issuing: "Arkansas, US", docEnding: "2257", dobYear: 1993,
    liveness: 94, addressMatch: true, pep: true, sanctionsHits: [], reason: "Vendor flagged a possible politically exposed person (PEP) match — local office holder with the same name.",
    audit: base("vk_9A0F13", "Jordan Pierce", 5),
  },
];

export const ID_STATUS: Record<IdStatus, { label: string; tone: "warning" | "info" | "error" | "success" | "neutral" }> = {
  "needs-review": { label: "Needs review", tone: "warning" },
  "needs-info": { label: "Waiting on user", tone: "info" },
  escalated: { label: "Escalated", tone: "error" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
};

/* Disputes and refunds — summary only until those queues are specced. */
export const DISPUTES = [
  { id: "DSP-2207", subject: "Perk not delivered — Low Ends vinyl", openedAt: hoursAgo(70) },
  { id: "DSP-2211", subject: "Wrong shirt size shipped", openedAt: hoursAgo(26) },
  { id: "DSP-2214", subject: "Card chargeback — backer says pledge not recognized", openedAt: hoursAgo(6) },
];
export const REFUNDS = [
  { id: "RFD-5130", subject: "Goal missed — auto-refund batch (88 backers)", openedAt: hoursAgo(3) },
  { id: "RFD-5127", subject: "Show rescheduled — backer opted out", openedAt: hoursAgo(31) },
  { id: "RFD-5121", subject: "Duplicate pledge", openedAt: hoursAgo(50) },
];
