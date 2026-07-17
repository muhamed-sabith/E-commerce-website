import { defineConfig } from "@playwright/test";

/**
 * End-to-end smoke tests. Playwright boots both dev servers itself and
 * waits on real readiness endpoints, so a green run means the full
 * browser → Vite → Express → PostgreSQL path works.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  // Every spec mutates the one shared dev database (stock, prices, store
  // settings); running files one at a time keeps those states deterministic.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    // Use the system Chrome (channel) instead of the Playwright-bundled
    // Chromium — avoids the ~150MB CDN download in restricted networks.
    channel: "chrome",
  },
  webServer: [
    {
      command: "npm run dev",
      cwd: "api",
      url: "http://localhost:4000/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev",
      cwd: "web",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
