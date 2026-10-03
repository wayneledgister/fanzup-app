import { defineConfig, devices } from "@playwright/test";

/**
 * M1 golden journey (NFR-QA-02; ADR-006). Expects a running stack:
 *   WEB_URL            the web app (vite preview, proxies /api)         default http://localhost:4173
 *   SUPABASE_URL       Supabase API gateway (auth at /auth/v1)          default http://127.0.0.1:55321
 *   SUPABASE_ANON_KEY  publishable key
 *   MAILPIT_URL        Supabase CLI's mail catcher                      default http://127.0.0.1:55324
 * CI starts all of it in .github/workflows/ci.yml (job "e2e").
 */
export default defineConfig({
  testDir: ".",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium-mobile", use: { ...devices["Pixel 7"] } }],
});
