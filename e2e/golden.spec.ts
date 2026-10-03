/**
 * M1 golden journey (exit tests 1–7; NFR-QA-02). Real Supabase Auth (sign-up, confirmation email, TOTP for staff),
 * the sandbox payment provider, the API and the worker.
 *
 *  Browser (a fan on a phone): campaign page → pick perk → Back → sign up → confirmation email → lands on checkout
 *  with the same perk → pay → confirmation → My backings. Then backs a second campaign straight from the page.
 *  API (artist + operator): two campaigns created, reviewed (aal2), published; time moves past the deadline;
 *  milestone evidence + verification; reconciliation must diff to zero; one correlation id traces a release.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { api, confirmationLink, latestEmail, poll, seedSignIn, staffToken } from "./support";

const run = Date.now().toString(36);
const fanEmail = `fan-${run}@fanzup.test`;
/** Throwaway sign-in credential generated per run for the test fan (not a secret). */
const fanCredential = `Fan-${randomUUID()}-A1`; // ggignore

/** Optional visual check: SCREENSHOTS_DIR=… saves full-page screenshots of the wired screens. */
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (process.env.SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.SCREENSHOTS_DIR}/${name}.png`, fullPage: true });
};

type Action = { action: { id: string; status: string; correlationId: string } };

test("fund one campaign through both milestones, refund another in full, reconcile to zero", async ({ page }) => {
  // ── Artist + operator set up two campaigns through the API ─────────────
  const artist = await seedSignIn("nova@fanzup.test"); // ggignore
  const staff = await staffToken("reviewer@fanzup.test");
  expect((await api("/artist/payout-account", { method: "POST", token: artist })).status).toBe(200);

  async function campaign(slug: string, goalMinor: number) {
    const c = await api<{ id: string }>("/artist/campaigns", { token: artist, body: { slug, title: `E2E ${slug}`, type: "Show", story: "An end-to-end test show.", goalMinor, durationDays: 7, milestoneRelease: true } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body.id;
    expect((await api(`/artist/campaigns/${id}/perks`, { method: "PUT", token: artist, body: [{ title: "Front-row ticket", kind: "experience", priceMinor: 50_000, quantityLimit: 20, fulfillBy: "2027-06-01" }] })).status).toBe(200);
    expect((await api(`/artist/campaigns/${id}/tranches`, { method: "PUT", token: artist, body: [{ seq: 1, pct: 50 }, { seq: 2, pct: 50, milestone: "Show played", evidenceRequired: "Settlement sheet", targetDate: "2027-05-01" }] })).status).toBe(200);
    expect((await api(`/artist/campaigns/${id}/submit`, { method: "POST", token: artist })).status).toBe(200);
    const review = await api<Action>(`/staff/campaigns/${id}/review`, { token: staff, body: { decision: "approved", reason: "E2E: story, perks and milestones check out" } });
    expect(review.body.action.status).toBe("executed");
    const pub = await api<{ endsAt: string }>(`/artist/campaigns/${id}/publish`, { method: "POST", token: artist });
    expect(pub.status).toBe(200);
    return { id, slug, endsAt: pub.body.endsAt };
  }
  const funded = await campaign(`e2e-fund-${run}`, 50_000); // one $500 backing meets the goal
  const failing = await campaign(`e2e-fail-${run}`, 100_000); // one $500 backing doesn't

  // ── The fan: campaign page → perk → Back → full account first (card G1-B option 3) ──
  await page.goto(`/campaigns/${funded.slug}?ref=e2e`);
  await expect(page.getByRole("heading", { name: `E2E ${funded.slug}` })).toBeVisible();
  await expect(page.getByText("Test mode — no real money moves").first()).toBeVisible();
  await shot(page, "1-campaign");
  await page.getByTestId("perk-option").first().click();
  await page.getByTestId("back-cta").click();
  await expect(page).toHaveURL(/\/signup\?next=/);
  await page.getByLabel("Your name").fill("E2E Fan");
  await page.getByLabel("Email address").fill(fanEmail);
  await page.getByLabel("Password", { exact: true }).fill(fanCredential); // ggignore
  await page.getByText("I'm 18 or older.").click();
  await page.getByText("I agree to the").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await shot(page, "2-check-email");

  // Open the confirmation link → signed in → straight back to checkout with the same campaign and perk.
  await page.goto(confirmationLink(await latestEmail(fanEmail)));
  await expect(page).toHaveURL(new RegExp(`/checkout/${funded.slug}\\?perk=`), { timeout: 30_000 });
  await expect(page.getByText("Front-row ticket").first()).toBeVisible();
  await expect(page.getByTestId("checkout-total")).toHaveText("$500.00");
  await shot(page, "3-checkout");

  // Pay with the sandbox test card; a decline first proves the failure path keeps the fan on checkout.
  await page.getByTestId("continue-to-payment").click();
  await page.getByLabel("Card number").fill("4000 0000 0000 0002");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("checkout-failure")).toContainText("declined");
  await shot(page, "4-declined");
  await page.getByLabel("Card number").fill("4242 4242 4242 4242");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("checkout-confirmed")).toBeVisible();
  await shot(page, "5-confirmed");

  // Second campaign: already signed in and verified, "Back" goes straight to checkout.
  await page.goto(`/campaigns/${failing.slug}`);
  await page.getByTestId("perk-option").first().click();
  await page.getByTestId("back-cta").click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${failing.slug}`));
  await page.getByTestId("continue-to-payment").click();
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("checkout-confirmed")).toBeVisible();

  await page.goto("/backed");
  await expect(page.getByTestId("backing-row")).toHaveCount(2);
  await expect(page.locator('[data-money-state="held"]')).toHaveCount(2);

  // ── Time passes: both deadlines (ADR-006: sandbox tick) ───────────────
  const after = new Date(Math.max(Date.parse(funded.endsAt), Date.parse(failing.endsAt)) + 3_600_000).toISOString();
  const tick = await api<{ settled: { id: string; outcome: string }[] }>(`/dev/sandbox/tick?now=${encodeURIComponent(after)}`, { method: "POST" });
  expect(tick.body.settled).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: funded.id, outcome: "funded" }),
    expect.objectContaining({ id: failing.id, outcome: "failed" }),
  ]));

  // Milestone 2: evidence from the artist, verification by the operator (aal2, typed reason), automatic release.
  const detail = await api<{ tranches: { seq: number; status: string }[] }>(`/campaigns/${funded.slug}`);
  expect(detail.body.tranches.find((t) => t.seq === 1)?.status).toBe("released");
  const mine = await api<{ tranches: { id: string; seq: number; status: string }[] }>(`/artist/campaigns/${funded.id}`, { token: artist });
  const t2 = mine.body.tranches.find((t) => t.seq === 2)!.id;
  expect((await api(`/artist/tranches/${t2}/evidence`, { token: artist, body: { notes: "Venue settlement sheet for the show", links: ["https://example.com/settlement.pdf"] } })).status).toBe(201);
  const verify = await api<Action>(`/staff/tranches/${t2}/verify`, { token: staff, body: { reason: "E2E: settlement sheet matches the show" } });
  expect(verify.body.action.status).toBe("executed");
  await api("/dev/sandbox/tick", { method: "POST" });

  // ── The fan sees both outcomes ─────────────────────────────────────────
  await page.reload();
  await expect(page.locator('[data-money-state="released"]')).toHaveCount(1);
  await expect(page.locator('[data-money-state="refunded"]')).toHaveCount(1);
  await expect(page.getByText(/Refunded \$500\.00 on/)).toBeVisible();
  await shot(page, "6-my-backings");

  // ── Reconciliation: ledger ↔ provider diffs to zero (exit test 3) ──────
  const recon = await poll(
    () => api<{ diffMinor: number; campaigns: { campaignId: string; diffMinor: number }[]; breaks: { campaignId: string | null }[] }>("/staff/recon/run", { method: "POST", token: staff }),
    (r) => r.body.campaigns.filter((c) => [funded.id, failing.id].includes(c.campaignId)).length === 2,
  );
  const ours = recon.body.campaigns.filter((c) => [funded.id, failing.id].includes(c.campaignId));
  expect(ours.map((c) => c.diffMinor)).toEqual([0, 0]);
  expect(recon.body.breaks.filter((b) => b.campaignId && [funded.id, failing.id].includes(b.campaignId))).toEqual([]);
  expect(recon.body.diffMinor).toBe(0);

  // ── One correlation id traces the operator's verification through the payout (exit test 4) ──
  const trace = await api<{ actions: unknown[]; outboundOps: { kind: string; status: string }[]; ledger: { kind: string }[] }>(`/staff/trace/${verify.body.action.correlationId}`, { token: staff });
  expect(trace.body.actions).toHaveLength(1);
  expect(trace.body.outboundOps).toEqual([expect.objectContaining({ kind: "payout", status: "confirmed" })]);
  expect(trace.body.ledger.map((l) => l.kind)).toEqual(["tranche.released"]);
});
