import { defineConfig, devices } from '@playwright/test'

/**
 * E2E configuration.
 *
 * - `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`): the CMS under test.
 *   When it points at localhost and nothing is listening yet, Playwright starts
 *   `vite dev` on that port with the current environment. To run against an
 *   isolated database/bucket/redis on :3100 (the setup spec WIPES the
 *   database), use `pnpm test:e2e:isolated` (see scripts/e2e-isolated.mjs).
 * - `PW_CHROMIUM_PATH`: use a locally installed Chromium instead of the one
 *   Playwright downloads (e.g. `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
 * - `QA_SCREENSHOT_DIR`: where the QA walkthrough writes its screenshots
 *   (default `test-results/qa-screens`).
 *
 * The dev server serves ~2000 unbundled modules and hydrates in ~6–7s warm, so
 * expectations wait up to 15s and `e2e/global-setup.ts` warms it up first.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const base = new URL(baseURL)
const port = base.port || (base.protocol === 'https:' ? '443' : '80')
const isLocal = ['localhost', '127.0.0.1'].includes(base.hostname)

const executablePath = process.env.PW_CHROMIUM_PATH || undefined
const chrome = {
  ...devices['Desktop Chrome'],
  ...(executablePath ? { launchOptions: { executablePath } } : {}),
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every test signs in and hydrates several heavy screens on a dev server.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/global-setup.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 45_000,
    // The UI is English-only in the specs; pin it regardless of the host.
    locale: 'en-US',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /setup\.spec\.ts/,
      fullyParallel: false,
      use: chrome,
    },
    {
      name: 'chromium',
      testIgnore: /setup\.spec\.ts|qa\/|docs\//,
      use: chrome,
      dependencies: ['setup'],
    },
    {
      name: 'qa',
      testMatch: /qa\/.*\.spec\.ts/,
      fullyParallel: false,
      timeout: 300_000,
      use: chrome,
    },
  ],
  // Several workers against one dev server; keep it moderate.
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 3,
  webServer: isLocal
    ? {
        command: `pnpm exec vite dev --port ${port} --strictPort`,
        url: `${base.origin}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
        // A frozen dev server: no watcher, no hot reloads (see vite.config.ts).
        env: {
          VITE_FREEZE: 'true',
          // Setup spec token; the seeded admins have no two-factor enrolled.
          SETUP_TOKEN: process.env.SETUP_TOKEN ?? 'e2e-setup-token-0123456789',
          ADMIN_MFA_REQUIRED: 'false',
        },
      }
    : undefined,
})
