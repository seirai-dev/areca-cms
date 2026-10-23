import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

/**
 * Documentation screenshots (`pnpm docs:screenshots`). Separate from the e2e
 * config so the normal `chromium` and `qa` projects never pick these up.
 * Runs against a CMS that is already running (no webServer), at the origin in
 * APP_URL (apps/cms/.env.local) unless PLAYWRIGHT_BASE_URL is set.
 */
function appUrlFromEnvLocal() {
  try {
    const text = readFileSync(
      fileURLToPath(new URL('./.env.local', import.meta.url)),
      'utf8',
    )
    return text.match(/^APP_URL\s*=\s*(\S+)/m)?.[1] ?? null
  } catch {
    return null
  }
}

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  appUrlFromEnvLocal() ??
  'http://localhost:3000'
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: './e2e/docs',
  testMatch: /docs-screenshots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60 * 60_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'Europe/London',
    trace: 'off',
    screenshot: 'off',
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'docs-screenshots',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
