/**
 * Services marketplace journey (CR-005, Phase MKT-1; FR-MKT-001…010; specs/marketplace/03-tasks.md MKT-T-016).
 * Real Supabase Auth, the API and the web app. MKT-1 moves no money (ADR-010): nothing here is charged.
 *
 *  API (operator):  flag off → 404 marketplace_disabled; staff turns `flag.marketplace` on (audited `flag.set`).
 *  API (staff, CR-007): invite the provider and the artist (closed beta, audience `invited`; privileged `marketplace.invite`).
 *  Browser (provider on a phone): open the invite link → join → accept the Provider Terms → create profile → add a
 *                                 service → submit for review.
 *  Browser (staff, aal2):         /admin/providers → list the provider.
 *  Browser (artist):              invite link → join → /services → search → provider page → request → My requests ("Waiting for the provider").
 *  Browser (provider):            /provider/requests → accept with a note.
 *  Browser (artist):              My requests shows "Accepted", the note and the provider's contact email.
 *  Browser (staff):               /admin/marketplace shows both invites redeemed and the beta numbers.
 *  The flag goes back to its earlier value at the end, so the other journeys see the default (off) state.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { api, SEED_PASSWORD, SERVICE_ROLE_KEY, SUPABASE_URL, staffToken, staffTotpCode } from "./support";

const run = Date.now().toString(36);
const providerEmail = `provider-${run}@fanzup.test`;
/** Throwaway sign-in credential generated per run for the test provider (not a secret). */
const providerCredential = `Prov-${randomUUID()}-A1`; // ggignore
const slug = `e2e-studio-${run}`;
const providerName = `E2E Studio ${run}`;
const contactEmail = `bookings-${run}@fanzup.test`;

const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.SCREENSHOTS_DIR}/mkt-${name}.png`, fullPage: true });
};

async function logIn(page: Page, email: string, credential: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(credential); // ggignore
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(next));
}

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
    if (await page.waitForURL(new RegExp(next), { timeout: 10_000 }).then(() => true, () => false)) return;
  }
  throw new Error("staff TOTP sign-in did not complete");
}

/** Open an invite link signed out, as an invitee would: sign-in happens on the way, then the invite is redeemed (CR-007). */
async function joinViaLink(page: Page, link: string, email: string, credential: string) {
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(credential); // ggignore
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("join-done")).toContainText("You're in");
}

const logOut = (page: Page) => page.context().clearCookies().then(() => page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }));

type Config = { flags: { marketplace: boolean }; legal: { termsVersion: string; privacyVersion: string } };
type Action = { action: { status: string } };

test("services marketplace: provider lists, staff vets, artist requests, provider accepts (no money moves)", async ({ page }) => {
  test.skip(!SERVICE_ROLE_KEY, "needs the local stack's service-role key to create a confirmed provider account");
  const staff = await staffToken("reviewer@fanzup.test");
  const setFlag = async (on: boolean) => {
    const r = await api<Action>("/staff/flags/marketplace", { token: staff, body: { on, reason: `E2E marketplace journey (${on ? "on" : "back off"})` } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.action.status).toBe("executed");
  };
  const wasOn = (await api<Config>("/config")).body.flags.marketplace;

  // ── Flag off: every marketplace route is closed (FR-MKT-010) ──
  if (wasOn) await setFlag(false);
  const closed = await api<{ error?: { code?: string }; code?: string }>("/services");
  expect(closed.status).toBe(404);
  expect(JSON.stringify(closed.body)).toContain("marketplace_disabled");

  await setFlag(true);
  try {
    expect((await api<Config>("/config")).body.flags.marketplace).toBe(true);

    // A confirmed account for the provider (local/CI stack only: the Auth admin API with the service-role key).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    // The same metadata the sign-up form sends (FR-ID-006): 18+ attestation and the current terms versions.
    const { legal } = (await api<Config>("/config")).body;
    const made = await admin.auth.admin.createUser({
      email: providerEmail, password: providerCredential, email_confirm: true, // ggignore
      user_metadata: { display_name: providerName, adult_attested: true, terms_version: legal.termsVersion, privacy_version: legal.privacyVersion },
    });
    expect(made.error, made.error?.message).toBeNull();

    // ── Closed beta (CR-007): outsiders are refused; staff invite the provider and the artist ──
    expect((await api<{ error?: string }>("/services")).status).toBe(401);
    const inviteFor = async (email: string, kind: "provider" | "artist") => {
      const create = () => api<{ code: string; invite: { status: string } }>("/staff/marketplace/invites", { token: staff, body: { email, kind, reason: `E2E closed-beta invite (${kind})` } });
      let r = await create();
      if (r.status === 409) {
        // An open invite left by an earlier local run that stopped before joining: revoke it and invite again.
        const list = await api<{ items: { id: string; email: string; status: string }[] }>("/staff/marketplace/invites", { token: staff });
        for (const i of list.body.items.filter((x) => x.email === email && (x.status === "open" || x.status === "expired"))) {
          await api(`/staff/marketplace/invites/${i.id}/revoke`, { token: staff, body: { reason: "E2E: replace a leftover invite" } });
        }
        r = await create();
      }
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.invite.status).toBe("open");
      return `/services/join#code=${encodeURIComponent(r.body.code)}`;
    };
    const providerLink = await inviteFor(providerEmail, "provider");
    const artistLink = await inviteFor("nova@fanzup.test", "artist");

    // ── Provider: invite link → join → Provider Terms → profile → one service → submit (FR-MKT-003/004/023/025) ──
    await joinViaLink(page, providerLink, providerEmail, providerCredential);
    await shot(page, "0-provider-joined");
    await page.getByRole("button", { name: "Set up my provider profile" }).click();
    await expect(page.getByRole("heading", { name: "Your provider profile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create profile" })).toBeDisabled();
    await page.getByTestId("provider-terms").getByText("I've read and agree to the Provider Terms").click();
    await page.getByTestId("accept-provider-terms").click();
    await expect(page.getByTestId("provider-terms")).toBeHidden();
    await expect(page.getByText("FanZuP doesn't handle payment for services yet").first()).toBeVisible();
    await page.getByLabel("Name artists will see").fill(providerName);
    await page.getByLabel("Profile address").fill(slug);
    await page.getByLabel("Headline").fill("Mixing and mastering for independent artists");
    await page.getByLabel("About").fill("Ten years mixing live records and EPs.");
    await page.getByLabel("City").fill("Atlanta");
    await page.getByLabel("Contact email").fill(contactEmail);
    await page.getByRole("button", { name: "Mixing & mastering" }).click();
    await page.getByLabel("Portfolio links").fill("https://example.com/portfolio");
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByRole("status")).toHaveText("Profile saved.");
    await page.getByRole("button", { name: "Add a service" }).click();
    await page.getByLabel("Service", { exact: true }).fill("Mix and master one song");
    await page.locator("#ls-desc-0").fill("Stems in, a release-ready master out.");
    await page.getByLabel("Starting at (USD)").fill("250");
    await page.getByLabel("Price basis").selectOption("song");
    await page.getByLabel("Typical turnaround (days)").fill("7");
    await page.getByRole("button", { name: "Save services" }).click();
    await expect(page.getByRole("status")).toHaveText("Services saved.");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("status")).toHaveText("Submitted for review.");
    await expect(page.getByText("in review").first()).toBeVisible();
    await shot(page, "1-provider-submitted");

    // Not listed yet: the public directory doesn't show it (FR-MKT-008).
    expect((await api(`/services/providers/${slug}`)).status).toBe(404);

    // ── Staff vetting at aal2 (privileged provider.review) ──
    await logOut(page);
    await staffLogIn(page, "reviewer@fanzup.test", "/admin/providers");
    const row = page.getByTestId("staff-providers").locator("div.p-4", { hasText: `/${slug}` });
    await expect(row).toBeVisible();
    await shot(page, "2-staff-queue");
    const listForm = row.locator("form", { has: page.getByRole("button", { name: "List provider" }) });
    await listForm.getByLabel("Reason (goes in the audit log)").fill("E2E: portfolio link and profile check out");
    await listForm.getByRole("button", { name: "List provider" }).click();
    // Listing moves the provider out of the "in review" queue and into "listed".
    await expect(row).toBeHidden();
    await page.getByRole("tab", { name: "listed" }).click();
    await expect(page.getByTestId("staff-providers").locator("div.p-4", { hasText: `/${slug}` })).toBeVisible();
    await expect.poll(async () => (await api(`/services/providers/${slug}`)).status, { timeout: 20_000 }).toBe(200);

    // ── Artist: browse → provider page → request (FR-MKT-001/002/005) ──
    await logOut(page);
    await joinViaLink(page, artistLink, "nova@fanzup.test", SEED_PASSWORD);
    await page.getByRole("button", { name: "Browse services" }).click();
    await expect(page.getByRole("heading", { name: "Find the people who help you finish the work" })).toBeVisible();
    await page.getByLabel("Search").fill("master");
    await page.getByRole("button", { name: "Search" }).click();
    const result = page.getByTestId("service-results").getByRole("link", { name: "Mix and master one song" }).first();
    await expect(result).toBeVisible();
    await expect(page.getByTestId("service-results")).toContainText(/Starting at \$250(\.00)? per song/);
    await shot(page, "3-browse");
    await page.goto(`/services/${slug}`);
    await expect(page.getByRole("heading", { name: providerName })).toBeVisible();
    await page.getByRole("button", { name: "Request this" }).first().click();
    await page.getByLabel("What do you need?").fill("Two live tracks from the Atlanta show, mixed and mastered for the campaign video.");
    await page.getByLabel("Budget (USD)").fill("500");
    await shot(page, "4-request-form");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Request sent")).toBeVisible();
    await page.getByRole("link", { name: "See your requests" }).click();
    const mine = page.getByTestId("my-service-requests").locator("li", { hasText: providerName });
    await expect(mine).toContainText("Waiting for the provider");
    await expect(mine).not.toContainText(contactEmail); // contact only after accept (FR-MKT-006)

    // ── Provider: accept with a note (FR-MKT-006) ──
    await logOut(page);
    await logIn(page, providerEmail, providerCredential, "/provider/requests");
    const incoming = page.locator("li", { hasText: "Mix and master one song" }).first();
    await expect(incoming).toContainText("Two live tracks");
    await expect(incoming).toContainText(/\$500(\.00)?/);
    await incoming.getByLabel("Note to the artist").fill("Happy to help. Send the stems when ready.");
    await shot(page, "5-provider-inbox");
    await incoming.getByRole("button", { name: "Accept" }).click();
    await expect(incoming).toContainText("Accepted: get in touch");
    await expect(incoming.getByRole("link", { name: /nova@fanzup\.test/ })).toBeVisible(); // the artist shared their email

    // ── Artist sees the answer and the provider's contact email ──
    await logOut(page);
    await logIn(page, "nova@fanzup.test", SEED_PASSWORD, "/services/requests");
    const answered = page.getByTestId("my-service-requests").locator("li", { hasText: providerName });
    await expect(answered).toContainText("Accepted: get in touch");
    await expect(answered).toContainText("Happy to help");
    await expect(answered.getByRole("link", { name: contactEmail })).toBeVisible();
    await shot(page, "6-artist-accepted");

    // ── Staff: the beta page shows the redeemed invites and the numbers (FR-MKT-022/028/029) ──
    await logOut(page);
    await staffLogIn(page, "reviewer@fanzup.test", "/admin/marketplace");
    await expect(page.getByTestId("beta-metrics")).toContainText("Providers listed");
    await expect(page.getByTestId("invites").locator("div.p-4", { hasText: providerEmail })).toContainText("redeemed");
    await expect(page.getByTestId("members")).toContainText(providerName);
    await shot(page, "7-staff-beta");
  } finally {
    if (!wasOn) await setFlag(false);
  }
});
