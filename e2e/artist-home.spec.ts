/**
 * Live artist screens (CR-006, FR-CMP-009, ADR-011; specs/03-tasks.md M2-T-004). Real Supabase Auth, the API and the
 * web app, seeded data (supabase/seed.sql, dates relative to now).
 *
 *  Browser (visitor): `/` features a live campaign from the API, with days left (never "Ended" or negative).
 *  Browser (artist):  `/creator` signed out → login; signed in as Nova → the live tour leads the dashboard with the
 *                     API's numbers; campaign list → campaign page with perks and milestones.
 */
import { expect, test } from "@playwright/test";
import { SEED_PASSWORD, api, seedSignIn } from "./support";

test("home page features a live campaign from the API", async ({ page }) => {
  const live = await api<{ campaigns: { slug: string; title: string }[] }>("/v1/campaigns?tab=live");
  expect(live.status).toBe(200);
  const first = live.body.campaigns[0];
  await page.goto("/");
  const featured = page.getByTestId("featured-campaign");
  await expect(featured).toBeVisible();
  await expect(featured).toContainText(first.title);
  await expect(featured).toHaveAttribute("href", `/campaigns/${first.slug}`);
  await expect(featured).toContainText(/days left|left/);
  await expect(featured).not.toContainText("Ended");
  await expect(featured).not.toContainText(/-\d/); // no negative days left
});

test("artist dashboard, campaign list and campaign page read the artist's own data", async ({ page }) => {
  await page.goto("/creator");
  await expect(page).toHaveURL(/\/login\?next=%2Fcreator/);

  const token = await seedSignIn("nova@fanzup.test");
  const me = await api<{ campaigns: { id: string; slug: string; title: string; status: string; backers: number }[] }>("/v1/artist", { token });
  expect(me.status).toBe(200);
  const tour = me.body.campaigns.find((c) => c.slug === "nova-live-band-tour")!;
  expect(tour.status).toBe("live");

  await page.getByLabel("Email address").fill("nova@fanzup.test");
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD); // ggignore
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/creator$/);

  const current = page.getByTestId("current-campaign");
  await expect(current).toContainText(tour.title);
  await expect(current).toContainText("Live");
  await expect(page.getByTestId("dashboard-kpis")).toContainText("Days left");
  await expect(page.getByTestId("next-steps")).toContainText(`Share "${tour.title}"`);
  // Sample-data widgets are gone (FR-PLT-002).
  await expect(page.getByText("Monthly listeners")).toHaveCount(0);
  await expect(page.getByText("Path to Established")).toHaveCount(0);

  await page.goto("/creator/campaigns");
  await expect(page.getByTestId("campaign-list")).toContainText(tour.title);

  await page.getByTestId("campaign-list").getByRole("link").filter({ hasText: tour.title }).click();
  await expect(page).toHaveURL(new RegExp(`/creator/campaigns/${tour.id}$`));
  await expect(page.getByTestId("campaign-money")).toContainText("Backers");
  await expect(page.getByTestId("perk-inventory")).toContainText("claimed");
  await expect(page.getByTestId("campaign-milestones")).toContainText("Goal met");
  await expect(page.getByRole("link", { name: "View public page" })).toHaveAttribute("href", "/campaigns/nova-live-band-tour");
});
