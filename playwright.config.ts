import { defineConfig, devices } from "@playwright/test";

// Point PLAYWRIGHT_BASE_URL at the live Cloud Run URL to test the deployed
// site instead of a local dev server (e.g. in CI, or to check a real deploy).
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Only boot a local server when testing against localhost — hitting the
  // live Cloud Run URL shouldn't spin up a redundant local instance.
  webServer: baseURL.includes("localhost")
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 30_000,
      }
    : undefined,
});
