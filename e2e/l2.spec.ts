/**
 * Layer 2 journeys (CR-002; NFR-L2-04) on mock rails: real Supabase Auth, the API + worker, apps/mock-escrow with
 * signed webhooks, and the web app. Needs the stack started with REGCF_PROVIDER=mock and supabase/seed_layer2.sql.
 *
 *  1. Creator (browser) creates an album Pool → staff (API, aal2) approve the Form C and execute the collection
 *     agreement → creator launches (browser) → a new fan (browser) passes mock KYC, sets their limit, reads the
 *     documents and invests → the Pool funds → royalties are reported, cash arrives, reconciled → a distribution
 *     is committed and paid → the fan sees it in the portfolio. Ledger ⇄ provider reconciles to zero.
 *  2. A Pool misses its target → every investor is refunded; the fan's portfolio shows the refund.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { api, poll, SEED_PASSWORD, seedSignIn, staffToken } from "./support";

const run = Date.now().toString(36);
const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.SCREENSHOTS_DIR}/l2-${name}.png`, fullPage: true });
};

async function logIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD); // ggignore
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[?]/g, "\\?")));
}

/** Mock provider clock + one worker tick (dev route, mock rails only). */
const advance = (seconds: number) => api("/dev/l2/advance", { body: { seconds } });

type Money = { ledger: Record<string, number>; pool: { status: string; endsAt: string; id: string } };
type Action = { action: { status: string } };

test("album royalty Pool: create → Form C → KYC → invest → fund → royalties → distribution in the portfolio", async ({ browser }) => {
  const staff = await staffToken("reviewer@fanzup.test");
  const slug = `e2e-album-${run}`;
  const title = `E2E Album ${run}`;

  // ── Creator (Nova Reyes, Rising) creates the Pool in the browser ──────
  const creatorCtx = await browser.newContext();
  const creator = await creatorCtx.newPage();
  await logIn(creator, "nova@fanzup.test", "/creator/pools/new");
  await expect(creator.getByTestId("layer2-demo-banner")).toHaveText("Demo — not an offer of securities. Mock escrow and data.");
  await creator.getByLabel("Album title").fill(title);
  await creator.getByLabel("Pool address").fill(slug);
  await creator.getByLabel("Tracklist (one per line)").fill("Opening\nSecond song\nClosing");
  await creator.locator("#f-a-0").fill("3000");
  await creator.locator("#f-a-1").fill("2000");
  await expect(creator.getByTestId("target")).toHaveText("$5,000");
  await creator.getByLabel("Units", { exact: true }).fill("200");
  await creator.getByLabel("Unit price ($)").fill("50");
  await creator.locator("#tr-m-1").fill("Album mastered");
  await shot(creator, "1-create");
  await creator.getByTestId("submit-pool").click();
  await expect(creator.getByTestId("creator-pool-status")).toHaveText("in_review");
  const poolId = creator.url().split("/").pop()!;

  // ── Staff (aal2): Form C review + collection agreement ────────────────
  const review = await api<Action>(`/staff/l2/pools/${poolId}/review`, { token: staff, body: { decision: "approved", reason: "E2E: Form C matches the Pool data" } });
  expect(review.body.action.status, JSON.stringify(review.body)).toBe("executed");
  const exec = await api<Action>(`/staff/l2/pools/${poolId}/collection/execute`, { token: staff, body: { reason: "E2E: distributor letter countersigned (mock)" } });
  expect(exec.body.action.status).toBe("executed");

  // ── Creator launches ─────────────────────────────────────────────────
  await creator.reload();
  await creator.getByTestId("launch-pool").click();
  await expect(creator.getByTestId("creator-pool-status")).toHaveText("live");

  // ── A new fan (Eli: no KYC yet) verifies and invests in the browser ───
  const fanCtx = await browser.newContext();
  const fan = await fanCtx.newPage();
  await logIn(fan, "eli@fanzup.test", `/pools/${slug}`);
  await expect(fan.getByTestId("pool-title")).toHaveText(title);
  await expect(fan.getByTestId("payout-illustration")).toContainText("If the album earns nothing");
  await shot(fan, "2-pool");
  await fan.getByRole("link", { name: /Start investor verification/ }).click();
  await fan.getByLabel("Legal first name").fill("Eli");
  await fan.getByLabel("Legal last name").fill("Santos");
  await fan.getByLabel("State of residence").selectOption("PA");
  await fan.getByTestId("kyc-submit").click();
  await expect(fan.getByTestId("kyc-step")).toHaveAttribute("data-kyc-status", "approved", { timeout: 30_000 });
  await fan.getByLabel("Annual income (USD)").fill("300000");
  await fan.getByLabel("Net worth, excluding your home (USD)").fill("300000");
  await fan.locator("#c-confirm").check();
  await fan.getByTestId("certify-submit").click();
  await expect(fan.getByTestId("limit-summary")).toContainText("$30,000");
  await shot(fan, "3-investor");
  await fan.getByTestId("investor-continue").click();
  await expect(fan.getByTestId("pool-title")).toHaveText(title);
  await fan.getByTestId("units-input").fill("100");
  await fan.getByTestId("review-documents").click();
  for (const id of ["ack-risk", "ack-unsecured", "ack-lockup", "ack-formc"]) await fan.locator(`#${id}`).check();
  await shot(fan, "4-documents");
  await fan.getByTestId("confirm-investment").click();
  await expect(fan.getByTestId("confirmation")).toHaveAttribute("data-status", "funded", { timeout: 30_000 });
  await shot(fan, "5-confirmation");

  // ── Deadline passes: the Pool funds, Units issue, tranche 1 is released ──
  const money = async () => (await api<Money>(`/staff/l2/pools/${poolId}/money`, { token: staff })).body;
  const endsAt = new Date((await money()).pool.endsAt).getTime();
  await advance(Math.ceil((endsAt - Date.now()) / 1000) + 20 * 60);
  await advance(5);
  const funded = await poll(money, (m) => m.pool.status === "funded" && (m.ledger.pool_escrow ?? 0) === 2_500_00);
  expect(funded.pool.status).toBe("funded");

  // ── Royalties: statement (creator), cash into the collection account (mock), reconciliation ──
  const nova = await seedSignIn("nova@fanzup.test");
  const st = await api(`/creator/pools/${poolId}/statements`, { token: nova, body: { periodLabel: "Quarter 1", periodStart: "2027-01-01", periodEnd: "2027-03-31", lines: [{ revenueType: "master", source: "Mock Distributor", amountMinor: 90_000 }] } });
  expect(st.status, JSON.stringify(st.body)).toBe(201);
  expect((await api(`/staff/l2/pools/${poolId}/deposits`, { token: staff, body: { amountMinor: 90_000, reference: "Quarter 1" } })).status).toBe(200);
  await advance(5);
  await poll(async () => (await api(`/staff/l2/pools/${poolId}/recon`, { token: staff, body: {} })).body as { revenue: { unallocated_minor: number } }, (r) => r.revenue.unallocated_minor === 90_000);

  // ── Waterfall: dry-run → commit (same hash) → payouts settle ─────────
  const dry = await api<{ hash: string; allocation: { payouts: { amountMinor: number }[] } }>(`/staff/l2/pools/${poolId}/distributions/dry-run`, { token: staff, body: { label: "Quarter 1" } });
  expect(dry.body.allocation.payouts).toEqual([{ investmentId: expect.any(String), amountMinor: 27_000 }]);
  const commit = await api<Action>(`/staff/l2/pools/${poolId}/distributions/commit`, { token: staff, body: { label: "Quarter 1", hash: dry.body.hash, reason: "E2E: Q1 reconciled to the lockbox" } });
  expect(commit.body.action.status, JSON.stringify(commit.body)).toBe("executed");
  await advance(5);
  await advance(5);

  // ── The fan sees the distribution ─────────────────────────────────────
  await fan.goto("/portfolio");
  const row = fan.locator(`[data-testid=holding-row][data-pool='${slug}']`);
  await expect(row).toHaveAttribute("data-status", "issued");
  await expect(row.getByTestId("received")).toHaveText("$270");
  await shot(fan, "6-portfolio");
  await row.getByRole("link", { name: title }).click();
  await expect(fan.getByTestId("payouts")).toContainText("Quarter 1");
  await expect(fan.getByTestId("payouts")).toContainText("1099-DIV");

  // ── Ledger ⇄ provider reconcile to the cent ──────────────────────────
  const recon = await api<{ ledger: { diffMinor: number } }>(`/staff/l2/pools/${poolId}/recon`, { token: staff, body: {} });
  expect(recon.body.ledger.diffMinor).toBe(0);
  await creatorCtx.close();
  await fanCtx.close();
});

test("a Pool that misses its target refunds every investor in full", async ({ page }) => {
  const staff = await staffToken("reviewer@fanzup.test");
  const sol = await seedSignIn("sol@fanzup.test");
  const slug = `e2e-miss-${run}`;
  const create = await api<{ id: string }>("/creator/pools", {
    token: sol,
    body: {
      slug, title: `E2E Miss ${run}`, tracklist: ["One", "Two"], useOfFunds: [{ label: "Studio", amountMinor: 8_000_00 }], revenueTypes: ["master"], fansBps: 3000, platformBps: 500,
      unitsTotal: 200, unitPriceMinor: 50_00, durationDays: 14, collectionMechanism: "LOCKBOX", tranches: [{ seq: 1, pct: 50 }, { seq: 2, pct: 50, milestone: "Released" }],
    },
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const id = create.body.id;
  expect((await api(`/creator/pools/${id}/submit`, { method: "POST", token: sol })).status).toBe(200);
  await api(`/staff/l2/pools/${id}/review`, { token: staff, body: { decision: "approved", reason: "E2E: Form C matches the Pool data" } });
  await api(`/staff/l2/pools/${id}/collection/execute`, { token: staff, body: { reason: "E2E: lockbox agreement on file (mock)" } });
  const launch = await api<{ endsAt: string }>(`/creator/pools/${id}/launch`, { method: "POST", token: sol });
  expect(launch.status, JSON.stringify(launch.body)).toBe(200);

  // Jordan (fan@, KYC approved in the seed) invests $500 through the browser.
  await logIn(page, "fan@fanzup.test", `/pools/${slug}`);
  await page.getByTestId("units-input").fill("10");
  await page.getByTestId("review-documents").click();
  for (const a of ["ack-risk", "ack-unsecured", "ack-lockup", "ack-formc"]) await page.locator(`#${a}`).check();
  await page.getByTestId("confirm-investment").click();
  await expect(page.getByTestId("confirmation")).toHaveAttribute("data-status", "funded", { timeout: 30_000 });

  // Deadline passes below target → failed → refunds settle.
  await advance(Math.ceil((new Date(launch.body.endsAt).getTime() - Date.now()) / 1000) + 20 * 60);
  await advance(5);
  await advance(5);
  const money = await poll(
    async () => (await api<Money>(`/staff/l2/pools/${id}/money`, { token: staff })).body,
    (m) => m.pool.status === "refunded",
  );
  expect(money.pool.status).toBe("refunded");
  expect(money.ledger.pool_escrow ?? 0).toBe(0);
  await page.goto("/portfolio");
  await expect(page.locator(`[data-testid=holding-row][data-pool='${slug}']`)).toHaveAttribute("data-status", "refunded");
  await shot(page, "7-refunded");
  const recon = await api<{ ledger: { diffMinor: number } }>(`/staff/l2/pools/${id}/recon`, { token: staff, body: {} });
  expect(recon.body.ledger.diffMinor).toBe(0);
  void randomUUID;
});
