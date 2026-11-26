/**
 * Layer 2 journeys (CR-002; NFR-L2-04) on mock rails: real Supabase Auth, the API + worker, apps/mock-escrow with
 * signed webhooks, and the web app. Needs the stack started with REGCF_PROVIDER=mock and supabase/seed_layer2.sql.
 *
 *  1. Creator (browser) creates an album Pool (21-day default, issuer attestation) → staff (API, aal2) approve the
 *     Form C and execute the collection agreement → creator launches (browser, attestation again) → a new fan (browser)
 *     passes mock KYC, sets their limit, reads the documents (intermediary pending, unsecured line, D-2) and invests →
 *     the confirmation shows amount, price, Units, issuer and the cancel-by time → the Pool funds → a royalty statement
 *     for the first scheduled period, cash, reconciliation → staff in the BROWSER at aal2 (password + TOTP) dry-run and
 *     commit the distribution; the committed run's hash equals the dry-run's → the fan sees it in the portfolio.
 *     Ledger ⇄ provider reconciles to zero.
 *  2. A Pool misses its target → every investor is refunded; on the way, a cancel made in the browser while the
 *     payment is still moving (the mock holds that fund move pending — `POST /dev/l2/delays`) answers `cancel_pending`
 *     and the investment page says so; the confirmation page shows the cancel-by time. With the layer2 flag switched
 *     off, /portfolio is the cancel-only list (L2-T-038; PR #13 review round 2, findings 2 and 6): it lists the open
 *     investments, and one is cancelled from its cancel-only view.
 */
import { expect, test, type Page } from "@playwright/test";
import { api, poll, SEED_PASSWORD, seedSignIn, staffToken, staffTotpCode } from "./support";

const run = Date.now().toString(36);
const D2 = "Demo — not an offer of securities. Mock escrow and data.";
const INTERMEDIARY = "Intermediary: pending — L2-Q3";
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

/**
 * Staff in the browser at aal2: password, then the log-in page's TOTP step (the reviewer has a verified factor from
 * staffToken()). A code Auth already accepted in this 30-second step may be refused; then the next step's code is used.
 */
async function staffLogIn(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD); // ggignore
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Enter your verification code")).toBeVisible();
  for (const fresh of [false, true]) {
    const code = await staffTotpCode(email, { fresh });
    for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1}`).fill(code[i]);
    await page.getByRole("button", { name: "Verify and log in" }).click();
    const ok = await page.waitForURL(new RegExp(next), { timeout: 10_000 }).then(() => true, () => false);
    if (ok) return;
  }
  throw new Error("staff TOTP sign-in did not complete");
}

/** Mock provider clock + one worker tick (dev route, mock rails only). */
const advance = (seconds: number) => api("/dev/l2/advance", { body: { seconds } });

type Money = { ledger: Record<string, number>; pool: { status: string; endsAt: string; id: string } };
type Action = { action: { status: string } };
type Investment = { id: string; status: string; cancelRequestedAt: string | null; canCancelUntil: string | null };

test("album royalty Pool: create → Form C → KYC → invest → fund → royalties → distribution in the portfolio", async ({ browser }) => {
  const staff = await staffToken("reviewer@fanzup.test");
  const slug = `e2e-album-${run}`;
  const title = `E2E Album ${run}`;

  // ── Creator (Nova Reyes, Rising) creates the Pool in the browser ──────
  const creatorCtx = await browser.newContext();
  const creator = await creatorCtx.newPage();
  await logIn(creator, "nova@fanzup.test", "/creator/pools/new");
  await expect(creator.getByTestId("layer2-demo-banner")).toHaveText(D2);
  await creator.getByLabel("Album title").fill(title);
  await creator.getByLabel("Pool address").fill(slug);
  await creator.getByLabel("Tracklist (one per line)").fill("Opening\nSecond song\nClosing");
  await creator.locator("#f-a-0").fill("3000");
  await creator.locator("#f-a-1").fill("2000");
  await expect(creator.getByTestId("target")).toHaveText("$5,000");
  await creator.getByLabel("Units", { exact: true }).fill("200");
  await creator.getByLabel("Unit price ($)").fill("50");
  // L2-T-020: 21 days by default (the Reg CF minimum).
  await expect(creator.locator("#t-days")).toHaveValue("21");
  await creator.locator("#tr-m-1").fill("Album mastered");
  // L2-T-019: issuer attestation at submit, labelled as self-reported pending counsel.
  await expect(creator.getByTestId("attestation-note")).toContainText("Self-reported, pending counsel (L2-Q12)");
  await creator.locator("#p-other-sales").fill("0");
  await shot(creator, "1-create");
  await creator.getByTestId("submit-pool").click();
  await expect(creator.getByTestId("creator-pool-status")).toHaveText("in_review");
  const poolId = creator.url().split("/").pop()!;

  // ── Staff (aal2): Form C review + collection agreement ────────────────
  const review = await api<Action>(`/staff/l2/pools/${poolId}/review`, { token: staff, body: { decision: "approved", reason: "E2E: Form C matches the Pool data" } });
  expect(review.body.action.status, JSON.stringify(review.body)).toBe("executed");
  const exec = await api<Action>(`/staff/l2/pools/${poolId}/collection/execute`, { token: staff, body: { reason: "E2E: distributor letter countersigned (mock)" } });
  expect(exec.body.action.status).toBe("executed");

  // ── Creator launches (re-attests) ─────────────────────────────────────
  await creator.reload();
  await creator.locator("#l-other-sales").fill("0");
  await creator.getByTestId("launch-pool").click();
  await expect(creator.getByTestId("creator-pool-status")).toHaveText("live");

  // ── A new fan (Eli: no KYC yet) verifies and invests in the browser ───
  const fanCtx = await browser.newContext();
  const fan = await fanCtx.newPage();
  await logIn(fan, "eli@fanzup.test", `/pools/${slug}`);
  await expect(fan.getByTestId("pool-title")).toHaveText(title);
  await expect(fan.getByTestId("layer2-demo-banner")).toHaveText(D2);
  await expect(fan.getByTestId("payout-illustration")).toContainText("If the album earns nothing");
  await expect(fan.getByTestId("intermediary-line")).toHaveText(INTERMEDIARY);
  // L2-T-021: the strongest badge never stands alone.
  await expect(fan.getByTestId("risk-badge-strongest").first().getByTestId("unsecured-line")).toHaveText("Your claim is unsecured");
  await shot(fan, "2-pool");
  // Form C view: D-2 sentence and the pending intermediary (L2-T-016, L2-T-025).
  await fan.goto(`/pools/${slug}/form-c`);
  await expect(fan.getByTestId("form-c-notice")).toContainText(D2);
  await expect(fan.getByTestId("form-c-intermediary")).toHaveText(INTERMEDIARY);
  await fan.goto(`/pools/${slug}`);
  // Retry-safe: on a Playwright retry Eli is already verified from the first attempt, so the panel goes straight to
  // the documents step.
  const verify = fan.getByRole("link", { name: /Start investor verification/ });
  await expect(verify.or(fan.getByTestId("review-documents"))).toBeVisible();
  if (await verify.isVisible()) {
    await verify.click();
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
  }
  await fan.getByTestId("units-input").fill("100");
  await fan.getByTestId("review-documents").click();
  await expect(fan.getByTestId("intermediary-line")).toHaveText(INTERMEDIARY);
  await expect(fan.getByTestId("unsecured-line").first()).toBeVisible();
  for (const id of ["ack-risk", "ack-unsecured", "ack-lockup", "ack-formc"]) await fan.locator(`#${id}`).check();
  await shot(fan, "4-documents");
  await fan.getByTestId("confirm-investment").click();
  await expect(fan.getByTestId("confirmation")).toHaveAttribute("data-status", "funded", { timeout: 30_000 });
  // L2-T-044: the commitment summary (227.303(d) fields).
  await expect(fan.getByTestId("c-amount")).toHaveText("$5,000");
  await expect(fan.getByTestId("c-price")).toHaveText("$50");
  await expect(fan.getByTestId("c-units")).toHaveText("100");
  await expect(fan.getByTestId("c-issuer")).not.toBeEmpty();
  await expect(fan.getByTestId("c-cancel-by")).toHaveText(/\d{4}/);
  await expect(fan.getByTestId("cancel-start")).toBeVisible();
  await shot(fan, "5-confirmation");

  // ── Deadline passes: the Pool funds, Units issue, tranche 1 is released ──
  const money = async () => (await api<Money>(`/staff/l2/pools/${poolId}/money`, { token: staff })).body;
  const endsAt = new Date((await money()).pool.endsAt).getTime();
  await advance(Math.ceil((endsAt - Date.now()) / 1000) + 20 * 60);
  await advance(5);
  const funded = await poll(money, (m) => m.pool.status === "funded" && (m.ledger.pool_escrow ?? 0) === 2_500_00);
  expect(funded.pool.status).toBe("funded");

  // ── Royalties: statement for the first scheduled period (creator), cash (mock), reconciliation ──
  const nova = await seedSignIn("nova@fanzup.test");
  const periods = await api<{ periods: { seq: number; periodStart: string; periodEnd: string }[] }>(`/creator/pools/${poolId}/periods`, { token: nova });
  const p1 = periods.body.periods[0];
  expect(p1, JSON.stringify(periods.body)).toBeTruthy();
  const st = await api(`/creator/pools/${poolId}/statements`, { token: nova, body: { periodLabel: "Period 1", periodStart: p1.periodStart, periodEnd: p1.periodEnd, lines: [{ revenueType: "master", source: "Mock Distributor", amountMinor: 90_000 }] } });
  expect(st.status, JSON.stringify(st.body)).toBe(201);
  const dep = await api(`/staff/l2/pools/${poolId}/deposits`, { token: staff, body: { amountMinor: 90_000, reference: "Period 1" } });
  expect(dep.status, JSON.stringify(dep.body)).toBe(200);
  await advance(5);
  await poll(async () => (await api(`/staff/l2/pools/${poolId}/recon`, { token: staff, body: {} })).body as { revenue: { unallocated_minor: number } }, (r) => r.revenue?.unallocated_minor === 90_000);

  // ── Waterfall: the API dry-run (amounts), then staff in the browser at aal2: dry-run → commit, same hash ──
  const dry = await api<{ hash: string; allocation: { payouts: { amountMinor: number }[] } }>(`/staff/l2/pools/${poolId}/distributions/dry-run`, { token: staff, body: { label: "Period 1" } });
  expect(dry.body.allocation.payouts).toEqual([{ investmentId: expect.any(String), amountMinor: 27_000 }]);
  const staffCtx = await browser.newContext();
  const staffPage = await staffCtx.newPage();
  await staffLogIn(staffPage, "reviewer@fanzup.test", `/admin/pools/${poolId}`);
  await expect(staffPage.getByTestId("staff-pool-status")).toHaveText("funded");
  await expect(staffPage.getByTestId("layer2-demo-banner")).toHaveText(D2);
  // Natural signs: money held and owed read positive; nothing abnormal on a clean Pool.
  await expect(staffPage.locator("[data-testid=pool-ledger] [data-negative]")).toHaveCount(0);
  await staffPage.getByLabel("Run label").fill("Period 1");
  await staffPage.getByTestId("dry-run").click();
  const shownHash = (await staffPage.getByTestId("dry-run-hash").textContent())!.trim();
  expect(shownHash).toBe(dry.body.hash);
  await staffPage.locator("#r-commit-run").fill("E2E: Period 1 reconciled to the lockbox");
  await staffPage.getByTestId("commit-run").click();
  await expect(staffPage.getByText("Done.")).toBeVisible();
  await staffPage.reload();
  const committed = staffPage.locator("[data-testid=run-row][data-label='Period 1']").getByTestId("run-hash");
  await expect(committed).toHaveText(shownHash);
  await shot(staffPage, "6-staff-run");
  await advance(5);
  await advance(5);

  // ── The fan sees the distribution ─────────────────────────────────────
  await fan.goto("/portfolio");
  const row = fan.locator(`[data-testid=holding-row][data-pool='${slug}']`);
  await expect(row).toHaveAttribute("data-status", "issued");
  await expect(row.getByTestId("received")).toHaveText("$270");
  await expect(row.getByTestId("unsecured-line")).toBeVisible();
  await shot(fan, "7-portfolio");
  await row.getByRole("link", { name: title }).click();
  await expect(fan.getByTestId("payouts")).toContainText("Period 1");
  await expect(fan.getByTestId("payouts")).toContainText("1099-DIV");
  await expect(fan.getByTestId("unsecured-line").first()).toBeVisible();

  // ── Ledger ⇄ provider reconcile to the cent ──────────────────────────
  const recon = await api<{ ledger: { diffMinor: number } }>(`/staff/l2/pools/${poolId}/recon`, { token: staff, body: {} });
  expect(recon.body.ledger.diffMinor).toBe(0);
  await creatorCtx.close();
  await fanCtx.close();
  await staffCtx.close();
});

test("a Pool that misses its target refunds every investor in full", async ({ page }) => {
  const staff = await staffToken("reviewer@fanzup.test");
  const sol = await seedSignIn("sol@fanzup.test");
  const slug = `e2e-miss-${run}`;
  const create = await api<{ id: string }>("/creator/pools", {
    token: sol,
    body: {
      slug, title: `E2E Miss ${run}`, tracklist: ["One", "Two"], useOfFunds: [{ label: "Studio", amountMinor: 8_000_00 }], revenueTypes: ["master"], fansBps: 3000, platformBps: 500,
      unitsTotal: 200, unitPriceMinor: 50_00, durationDays: 21, collectionMechanism: "LOCKBOX", tranches: [{ seq: 1, pct: 50 }, { seq: 2, pct: 50, milestone: "Released" }],
    },
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const id = create.body.id;
  const submit = await api(`/creator/pools/${id}/submit`, { token: sol, body: { otherRegCfSales12mMinor: 0 } });
  expect(submit.status, JSON.stringify(submit.body)).toBe(200);
  await api(`/staff/l2/pools/${id}/review`, { token: staff, body: { decision: "approved", reason: "E2E: Form C matches the Pool data" } });
  await api(`/staff/l2/pools/${id}/collection/execute`, { token: staff, body: { reason: "E2E: lockbox agreement on file (mock)" } });
  const launch = await api<{ endsAt: string }>(`/creator/pools/${id}/launch`, { token: sol, body: { otherRegCfSales12mMinor: 0 } });
  expect(launch.status, JSON.stringify(launch.body)).toBe(200);

  // Jordan (fan@, KYC approved in the seed) commits $100 through the API while the mock holds new fund moves pending for
  // an hour of provider time (deterministic: nothing settles it until the deadline advance below), then cancels in the
  // browser while the payment is still moving → cancel_pending (L2-T-031).
  const jordan = await seedSignIn("fan@fanzup.test");
  const pool = await api<{ riskAckVersion: string }>(`/pools/${slug}`, { token: jordan });
  const hold = await api("/dev/l2/delays", { body: { fund: 3600 } });
  expect(hold.status, JSON.stringify(hold.body)).toBe(200);
  const small = await api<{ investmentId: string; status: string }>(`/pools/${id}/investments`, { token: jordan, body: { units: 2, riskAckVersion: pool.body.riskAckVersion }, headers: { "idempotency-key": `e2e-small-${run}` } })
    .finally(() => api("/dev/l2/delays", { body: { fund: 3 } })); // later fund moves settle in seconds again
  expect(small.status, JSON.stringify(small.body)).toBe(201);
  expect(small.body.status).toBe("funding");

  await logIn(page, "fan@fanzup.test", `/investments/${small.body.investmentId}`);
  const holding = page.getByTestId("holding");
  await expect(holding).toHaveAttribute("data-status", "funding");
  await page.getByTestId("cancel-start").click();
  await page.getByTestId("cancel-confirm").click();
  await expect(holding).toHaveAttribute("data-status", "cancel_pending");
  await expect(page.getByTestId("holding-help")).toContainText("Cancellation received");
  await expect(page.getByTestId("cancel-start")).toHaveCount(0);
  const pending = await api<Investment>(`/investments/${small.body.investmentId}`, { token: jordan });
  expect(pending.body).toMatchObject({ status: "funding", canCancelUntil: null });
  expect(pending.body.cancelRequestedAt).not.toBeNull();

  // …and invests $500 through the browser.
  await page.goto(`/pools/${slug}`);
  await page.getByTestId("units-input").fill("10");
  await page.getByTestId("review-documents").click();
  for (const a of ["ack-risk", "ack-unsecured", "ack-lockup", "ack-formc"]) await page.locator(`#${a}`).check();
  await page.getByTestId("confirm-investment").click();
  await expect(page.getByTestId("confirmation")).toHaveAttribute("data-status", "funded", { timeout: 30_000 });
  await expect(page.getByTestId("c-cancel-by")).toHaveText(/\d{4}/);
  await expect(page.getByTestId("c-units")).toHaveText("10");

  // Flag off while the offering is still open: /portfolio is the cancel-only list (completion route). It lists the open
  // investments — the funded $500 and the cancel-pending $100 — and the investor cancels an open one from its view.
  const one = await api<{ investmentId: string }>(`/pools/${id}/investments`, { token: jordan, body: { units: 1, riskAckVersion: pool.body.riskAckVersion }, headers: { "idempotency-key": `e2e-one-${run}` } });
  expect(one.status, JSON.stringify(one.body)).toBe(201);
  const off = await api<Action>("/staff/flags/layer2", { token: staff, body: { on: false, reason: "E2E: cancel-only list with the flag off" } });
  expect(off.status, JSON.stringify(off.body)).toBe(200);
  try {
    await page.goto("/portfolio");
    await expect(page.getByTestId("cancel-only-list")).toBeVisible();
    await expect(page.getByTestId("layer2-demo-banner")).toHaveText(D2);
    const open = page.locator(`[data-testid=cancel-only-row][data-pool='${slug}']`);
    await expect(open.filter({ hasText: "10 Units" })).toHaveAttribute("data-status", "funded");
    await expect(open.filter({ hasText: "2 Units" })).toHaveAttribute("data-status", "cancel_pending");
    await shot(page, "9-cancel-only-list");
    await open.filter({ hasText: "1 Unit ·" }).getByTestId("cancel-only-open").click();
    await expect(page).toHaveURL(new RegExp(`/investments/${one.body.investmentId}`));
    await expect(page.getByTestId("cancel-only-view")).toBeVisible();
    await page.getByTestId("cancel-start").click();
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("holding")).toHaveAttribute("data-status", /cancel_pending|refund_pending|refunded|cancelled/);
    await expect(page.getByTestId("cancel-start")).toHaveCount(0);
    const oneAfter = await api<Investment>(`/investments/${one.body.investmentId}`, { token: jordan });
    expect(oneAfter.body.cancelRequestedAt !== null || ["refund_pending", "refunded", "cancelled"].includes(oneAfter.body.status), JSON.stringify(oneAfter.body)).toBe(true);
    expect(oneAfter.body.canCancelUntil).toBeNull();
    await page.goto(`/pools/${slug}`);
    await expect(page.getByText("Investing isn't open yet")).toBeVisible();
  } finally {
    const on = await api<Action>("/staff/flags/layer2", { token: staff, body: { on: true, reason: "E2E: back on after the cancel-only check" } });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
  }

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
  const smallAfter = await api<Investment>(`/investments/${small.body.investmentId}`, { token: jordan });
  expect(["refunded", "cancelled", "returned"]).toContain(smallAfter.body.status);
  await page.goto("/portfolio");
  const rows = page.locator(`[data-testid=holding-row][data-pool='${slug}']`);
  await expect(rows.filter({ hasText: "10 Units" })).toHaveAttribute("data-status", "refunded");
  await shot(page, "8-refunded");
  const recon = await api<{ ledger: { diffMinor: number } }>(`/staff/l2/pools/${id}/recon`, { token: staff, body: {} });
  expect(recon.body.ledger.diffMinor).toBe(0);

});
