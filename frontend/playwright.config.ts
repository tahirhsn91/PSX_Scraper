import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke, run against a live stack — the dev compose stack by default.
 *
 * `PLAYWRIGHT_BASE_URL` is the only thing a CI job has to set; nothing here starts a server, because
 * the stack under test is the one the developer is already looking at.
 */
export default defineConfig({
  testDir: './e2e',
  // The dev database is a 512 MB Postgres container that the scraper also syncs 500 symbols
  // through, so a single request can stall for seconds. 45/10s produced failures that passed when
  // re-run alone; these budgets are sized for the stack as it actually behaves.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // Concurrent browsers against a stack that is also syncing compete for the same CPU and DB.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:5200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
