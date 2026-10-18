import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke, run against a live stack — the dev compose stack by default.
 *
 * `PLAYWRIGHT_BASE_URL` is the only thing a CI job has to set; nothing here starts a server, because
 * the stack under test is the one the developer is already looking at.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
