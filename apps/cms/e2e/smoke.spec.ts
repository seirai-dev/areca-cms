import { expect, test } from '@playwright/test'
import type { ConsoleMessage, Page } from '@playwright/test'

import {
  ACME_SITE,
  ADMIN,
  PASSWORD,
  TINY_PNG,
  authForm,
  hydrated,
  openAccountMenu,
  openSite,
  uniqueSuffix,
} from './helpers'

/**
 * Production-build smoke test (the `smoke` project, CI's `smoke` job). It
 * runs against a server started from `.output` on a freshly seeded database,
 * and it never touches the database the `setup` project wipes.
 *
 * Every test fails on a console error, an uncaught exception or a Content
 * Security Policy violation. Some violations (a blocked `eval`) are not logged
 * to the console, so the policy's own event is recorded too.
 */
async function recordProblems(page: Page) {
  const problems: string[] = []
  await page.exposeFunction('reportPageProblem', (message: string) => {
    problems.push(message)
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as { reportPageProblem?: (m: string) => void })
        .reportPageProblem
      report?.(
        `CSP ${event.violatedDirective} blocked ${event.blockedURI || 'inline'}: ${event.sample}`,
      )
    })
  })
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
  return problems
}

test('login page renders without console errors', async ({ page }) => {
  const problems = await recordProblems(page)
  await page.goto('/login')
  const form = await authForm(page)
  await expect(form.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await hydrated(page, form)
  expect(problems).toEqual([])
})

test('seeded admin signs in, opens the overview, the library and an entry editor', async ({
  page,
}) => {
  const problems = await recordProblems(page)
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(ADMIN)
  await page.getByLabel('Password').fill(PASSWORD)
  await form.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })

  await openSite(page, ACME_SITE)
  await expect(page.getByTestId('site-overview')).toBeVisible()

  // Uploads an image and checks that it loads from the asset route: the
  // policy's img-src must admit the same-origin asset URL.
  await page.getByTestId('sidebar').getByTestId('library-nav').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library-page')).toBeVisible()
  await hydrated(page, page.getByTestId('library-page'))
  const name = `smoke-${uniqueSuffix()}.png`
  await page
    .getByTestId('library-page')
    .getByTestId('media-upload')
    .setInputFiles({ name, mimeType: 'image/png', buffer: TINY_PNG })
  const tile = page.getByTestId(`media-card-${name}`)
  await expect(tile).toBeVisible()
  await expect(tile.locator('img')).toHaveJSProperty('naturalWidth', 1)

  // Theme switching writes a class and a transition-suppression style, both
  // of which must be allowed by the policy.
  await openAccountMenu(page)
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)

  await page.getByTestId('sidebar').getByTestId('collection-articles').click()
  await expect(page).toHaveURL(/\/c\/articles(?:\?.*)?$/)
  await hydrated(page, page.getByTestId('site-content'))
  await page.getByTestId('new-entry').click()
  await expect(page).toHaveURL(/\/c\/[^/]+\/new$/)
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await hydrated(page, page.getByTestId('editor-canvas'))

  expect(problems).toEqual([])
})
