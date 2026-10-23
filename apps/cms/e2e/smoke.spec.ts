import { expect, test } from '@playwright/test'
import type { ConsoleMessage, Page } from '@playwright/test'

import {
  ACME_SITE,
  ADMIN,
  PASSWORD,
  TINY_PNG,
  authForm,
  expectToast,
  hydrated,
  openAccountMenu,
  openSite,
  signOut,
  totpCode,
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
    if (message.type() !== 'error') return
    // A sign-in the server rate-limits is logged by the browser; the test
    // retries it (see submitWhenAllowed), so it is not a page problem.
    const rateLimited =
      message.text().includes('status of 429') &&
      /\/api\/auth\/(sign-in|sign-up)\//.test(message.location().url)
    if (!rateLimited) problems.push(message.text())
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

/**
 * Better Auth limits sign-in and sign-up requests per address (three in 10
 * seconds in production), and this test makes several back to back. Runs
 * `submit` and tries again every few seconds while the server answers 429.
 */
async function submitWhenAllowed(
  page: Page,
  endpoint: RegExp,
  submit: () => Promise<void>,
) {
  await expect(async () => {
    const response = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        endpoint.test(new URL(res.url()).pathname),
    )
    await submit()
    expect((await response).status(), `${endpoint} accepted`).not.toBe(429)
  }).toPass({ intervals: [5_000], timeout: 60_000 })
}

test('an admin invites someone, who accepts the link and turns on two-factor', async ({
  page,
  browser,
}) => {
  const problems = await recordProblems(page)
  const email = `invitee+${uniqueSuffix()}@example.com`

  await page.goto('/login')
  const adminForm = await authForm(page)
  await page.getByLabel('Email').fill(ADMIN)
  await page.getByLabel('Password').fill(PASSWORD)
  await submitWhenAllowed(page, /\/sign-in\/email$/, () =>
    adminForm.getByRole('button', { name: 'Sign in' }).click(),
  )
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
  await openSite(page, ACME_SITE)
  await page.getByTestId('sidebar').getByTestId('team-nav').click()
  await expect(page.getByTestId('people-page')).toBeVisible()
  await hydrated(page, page.getByTestId('people-page'))

  // The sheet's open and close animations and the success toast.
  await page.getByTestId('invite-member').click()
  const sheet = page.getByTestId('invite-sheet')
  await expect(sheet).toBeVisible()
  await page.getByTestId('invite-email').fill(email)
  await page.getByTestId('invite-send').click()
  await expectToast(page, /invitation/i)
  await expect(sheet).toBeHidden()
  const row = page.getByTestId(`invitation-row-${email}`)
  await expect(row).toBeVisible()

  // The link is shown once, in a dialog the admin copies it from.
  await row.getByTestId('invitation-regenerate-link').click()
  await expect(page.getByTestId('invitation-link-dialog')).toBeVisible()
  const link =
    (await page.getByTestId('invitation-link-value').textContent())?.trim() ??
    ''
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+$/)
  await page.getByTestId('invitation-link-done').click()

  // The invitee follows the link signed out and joins in one step.
  const guestContext = await browser.newContext({ locale: 'en-US' })
  const guest = await guestContext.newPage()
  const guestProblems = await recordProblems(guest)
  await guest.goto(link)
  const guestForm = await authForm(guest)
  await expect(guest.getByTestId('invite-email')).toHaveValue(email)
  await guest.getByLabel('Name').fill('Smoke Invitee')
  await guest.getByLabel('Password').fill(PASSWORD)
  await submitWhenAllowed(guest, /\/sign-up\/email$/, () =>
    guestForm.getByRole('button', { name: 'Create account and join' }).click(),
  )
  await expect(guest).toHaveURL(/\/sites\/[^/]+/, { timeout: 30_000 })
  await expect(guest.getByTestId('site-overview')).toBeVisible()

  // Two-factor: the QR code is an inline SVG, the secret is text, and the
  // next sign-in asks for a code from the app.
  await guest.goto('/account')
  await expect(guest.getByTestId('two-factor-section')).toBeVisible()
  await hydrated(guest, guest.getByTestId('two-factor-section'))
  await guest.getByTestId('two-factor-enable').click()
  await guest.locator('#two-factor-password').fill(PASSWORD)
  await guest
    .getByTestId('two-factor-password')
    .locator('button[type="submit"]')
    .click()
  await expect(guest.getByTestId('two-factor-qr').locator('svg')).toBeVisible()
  const secret =
    (await guest.getByTestId('two-factor-secret').textContent())?.trim() ?? ''
  await guest.locator('#two-factor-enrol-code').fill(totpCode(secret))
  await guest
    .getByTestId('two-factor-verify')
    .locator('button[type="submit"]')
    .click()
  await expect(guest.getByTestId('two-factor-codes')).toBeVisible()
  await guest.getByTestId('two-factor-done').click()
  await signOut(guest)

  await authForm(guest)
  await guest.getByLabel('Email').fill(email)
  await guest.getByLabel('Password').fill(PASSWORD)
  await submitWhenAllowed(guest, /\/sign-in\/email$/, () =>
    guest
      .locator('form[data-ready="true"]')
      .getByRole('button', { name: 'Sign in' })
      .click(),
  )
  await expect(guest.getByTestId('two-factor-form')).toBeVisible()
  await guest.locator('#two-factor-code').fill(totpCode(secret))
  await guest
    .getByTestId('two-factor-form')
    .locator('button[type="submit"]')
    .click()
  await expect(guest).not.toHaveURL(/\/login/, { timeout: 30_000 })

  await guestContext.close()
  expect(problems).toEqual([])
  expect(guestProblems).toEqual([])
})
