import { chromium } from '@playwright/test'
import type { FullConfig } from '@playwright/test'

import { startCloudflareStub } from './cloudflare-stub'

/**
 * Warms the dev server up before any spec runs. Vite compiles modules on
 * first request and the app hydrates slowly on a cold server, which made the
 * first tests of a run flaky. We load /login until its form reports
 * `data-ready="true"` (i.e. hydrated), then best-effort visit a few heavy
 * screens so their module graphs are compiled too.
 */
export default async function globalSetup(config: FullConfig) {
  // The Cloudflare stub serves the CMS dev server for the whole run.
  const stopCloudflareStub = await startCloudflareStub()
  try {
    await warmDevServer(config)
  } catch (error) {
    await stopCloudflareStub()
    throw error
  }
  return async () => {
    await stopCloudflareStub()
  }
}

async function warmDevServer(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3000'
  const executablePath = process.env.PW_CHROMIUM_PATH || undefined
  const browser = await chromium.launch(
    executablePath ? { executablePath } : undefined,
  )
  const started = Date.now()
  try {
    const page = await browser.newPage({ baseURL, locale: 'en-US' })
    const deadline = Date.now() + 180_000
    let ready = false
    while (!ready && Date.now() < deadline) {
      try {
        await page.goto('/login', { timeout: 90_000 })
        // `/login` redirects to `/setup` on an empty database.
        await page
          .locator('form[data-ready="true"]')
          .waitFor({ state: 'visible', timeout: 60_000 })
        ready = true
      } catch {
        await page.waitForTimeout(1_000)
      }
    }
    if (!ready) {
      throw new Error(`The CMS at ${baseURL} never became ready (/login).`)
    }

    // Best effort: compile the signed-in shell, a site, a collection and the
    // editor. Skipped silently when the seed data is not there.
    try {
      if (!page.url().includes('/login')) return
      await page.getByLabel('Email').fill('admin@areca.local')
      await page.getByLabel('Password').fill('password123')
      await page
        .locator('form[data-ready="true"]')
        .getByRole('button', { name: 'Sign in' })
        .click()
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 30_000,
      })
      await page.goto('/sites')
      const card = page.locator('[data-testid^="site-card-"]').first()
      await card.waitFor({ timeout: 30_000 })
      await card.click()
      await page.waitForURL(/\/sites\/[^/]+$/, { timeout: 30_000 })
      const siteUrl = page.url()
      await page.getByTestId('site-overview').waitFor({ timeout: 30_000 })
      await page.goto(`${siteUrl}/c/articles`)
      await page.getByTestId('site-content').waitFor({ timeout: 30_000 })
      await page.goto(`${siteUrl}/c/articles/new`)
      await page.getByTestId('entry-editor').waitFor({ timeout: 30_000 })
      await page.goto(`${siteUrl}/library`)
      await page.getByTestId('library-page').waitFor({ timeout: 30_000 })
      await page.goto('/agency')
      await page.getByTestId('agency-overview').waitFor({ timeout: 30_000 })
    } catch {
      // Warm-up only.
    }
  } finally {
    await browser.close()
    console.log(
      `[e2e] dev server warm (${Math.round((Date.now() - started) / 1000)}s)`,
    )
  }
}
