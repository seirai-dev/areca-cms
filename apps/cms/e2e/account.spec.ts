import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { Pool } from 'pg'

import {
  ACME_SITE,
  PASSWORD,
  authForm,
  createSiteOnClientPage,
  expectToast,
  hydrated,
  login,
  openAccountMenu,
  openAgency,
  openSite,
  signOut,
  uniqueSuffix,
  waitForInviteLink,
} from './helpers'

/**
 * Invites a new person into the signed-in admin's current site (so into that
 * site's client), then joins through the e-mailed link with a name and the
 * shared test password. Returns the person's own browser context and page.
 */
async function inviteAndJoin(
  browser: Browser,
  admin: Page,
  options: { email: string; name: string; role?: 'editor' | 'owner' },
): Promise<{ context: BrowserContext; guest: Page }> {
  await admin.getByTestId('sidebar').getByTestId('team-nav').click()
  await expect(admin.getByTestId('people-page')).toBeVisible()
  await admin.getByTestId('invite-member').click()
  const sheet = admin.getByTestId('invite-sheet')
  await expect(sheet).toBeVisible()
  await admin.getByTestId('invite-email').fill(options.email)
  if (options.role === 'owner') {
    await admin.getByTestId('invite-role-owner').click()
  }
  await admin.getByTestId('invite-send').click()
  await expect(sheet).toBeHidden()

  const link = await waitForInviteLink(options.email)
  const context = await browser.newContext()
  const guest = await context.newPage()
  await guest.goto(link)
  await authForm(guest)
  await guest.getByLabel('Name').fill(options.name)
  await guest.getByLabel('Password').fill(PASSWORD)
  await guest.getByRole('button', { name: 'Create account and join' }).click()
  await expect(guest).toHaveURL(/\/sites\/[^/]+/)
  await expect(guest.getByTestId('site-overview')).toBeVisible()
  return { context, guest }
}

/** Creates a client of its own with one site, and leaves the admin on that site. */
async function createClientWithSite(
  admin: Page,
  clientName: string,
  suffix: string,
) {
  await openAgency(admin)
  await admin.getByTestId('sidebar').getByTestId('clients-nav').click()
  await admin.getByTestId('new-organization').first().click()
  await admin.getByTestId('org-name').fill(clientName)
  await admin.getByTestId('create-client').click()
  const site = await createSiteOnClientPage(admin, suffix, 'E2E Account Site')
  await admin.getByTestId(`open-site-${site.siteSlug}`).click()
  await expect(admin.getByTestId('site-overview')).toBeVisible()
  await hydrated(admin, admin.getByTestId('sidebar'))
}

/** Submits the sign-in form and leaves the outcome to the caller. */
async function trySignIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await form.getByRole('button', { name: 'Sign in' }).click()
}

/** Blocks a person by a direct update, the same columns the block action sets. */
async function blockInDatabase(email: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const result = await pool.query(
      `update "user" set blocked_at = now(), blocked_reason = 'e2e' where email = $1`,
      [email.toLowerCase()],
    )
    expect(result.rowCount).toBe(1)
  } finally {
    await pool.end()
  }
}

test('rename yourself: the navbar shows the new name without a reload, Escape reverts', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  await login(page)
  await openSite(page, ACME_SITE)
  const { context, guest } = await inviteAndJoin(browser, page, {
    email: `rename+${suffix}@example.com`,
    name: 'Before Rename',
  })

  await guest.goto('/account')
  await hydrated(guest, guest.getByTestId('account-page'))
  const input = guest.getByTestId('account-name-input')
  const save = guest.getByTestId('account-name-save')
  await expect(input).toHaveValue('Before Rename')
  await expect(save).toBeDisabled()
  await expect(guest.getByTestId('account-email')).toHaveValue(
    `rename+${suffix}@example.com`,
  )
  await expect(guest.getByTestId('account-email')).toHaveAttribute(
    'readonly',
    '',
  )

  // A marker on the window: a full reload would clear it.
  await guest.evaluate(() => {
    ;(window as Window & { __sameDocument?: boolean }).__sameDocument = true
  })

  await input.fill('After Rename')
  await expect(save).toBeEnabled()
  await input.press('Escape')
  await expect(input).toHaveValue('Before Rename')
  await expect(save).toBeDisabled()

  await input.fill('  After Rename  ')
  await input.press('Enter')
  await expectToast(guest, 'Name saved')
  await expect(save).toBeDisabled()
  await expect(
    guest.evaluate(
      () => (window as Window & { __sameDocument?: boolean }).__sameDocument,
    ),
  ).resolves.toBe(true)

  const menu = await openAccountMenu(guest)
  await expect(menu).toContainText('After Rename')
  await expect(menu).not.toContainText('Before Rename')
  await context.close()
})

test('change your password, see the mismatch and wrong-password errors, then sign in with the new one', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const email = `password+${suffix}@example.com`
  const next = 'a brand new passphrase'
  await login(page)
  await openSite(page, ACME_SITE)
  const { context, guest } = await inviteAndJoin(browser, page, {
    email,
    name: 'Password Person',
  })

  await guest.goto('/account')
  await hydrated(guest, guest.getByTestId('account-page'))
  const form = guest.getByTestId('change-password-form')
  await expect(form).toBeVisible()

  await form.getByLabel('Current password').fill('not the password')
  await form.getByLabel('New password', { exact: true }).fill(next)
  await form.getByLabel('Confirm new password').fill(next)
  await guest.getByTestId('change-password-submit').click()
  await expect(form.getByLabel('Current password')).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await expect(guest.getByText('That password is not correct.')).toBeVisible()

  await form.getByLabel('Current password').fill(PASSWORD)
  await form.getByLabel('Confirm new password').fill(`${next}!`)
  await guest.getByTestId('change-password-submit').click()
  await expect(guest.getByText("The passwords don't match.")).toBeVisible()

  await form.getByLabel('Confirm new password').fill(next)
  await guest.getByTestId('change-password-submit').click()
  await expectToast(guest, 'Password changed. Other devices were signed out.')

  await signOut(guest)
  await trySignIn(guest, email, PASSWORD)
  await expect(guest.getByTestId('auth-error')).toBeVisible()
  await expect(guest).toHaveURL(/\/login/)
  await login(guest, email, next)
  await expect(guest).not.toHaveURL(/\/login/)
  await context.close()
})

test('a sole owner cannot delete the account: the client is named with a People link', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const clientName = `E2E Owner ${suffix}`
  await login(page)
  await createClientWithSite(page, clientName, suffix)
  const { context, guest } = await inviteAndJoin(browser, page, {
    email: `owner+${suffix}@example.com`,
    name: 'Sole Owner',
    role: 'owner',
  })

  await guest.goto('/account')
  await hydrated(guest, guest.getByTestId('account-page'))
  const blockers = guest.getByTestId('delete-account-blockers')
  await expect(blockers).toBeVisible()
  await expect(blockers).toContainText('Only you own this client')
  await expect(blockers).toContainText(clientName)
  const peopleLink = blockers.getByRole('link', { name: clientName })
  await expect(peopleLink).toHaveAttribute('href', /\/sites\/[^/]+\/people$/)
  await expect(guest.getByTestId('delete-account')).toBeDisabled()
  await expect(guest.getByTestId('delete-account-dialog')).toHaveCount(0)
  await context.close()
})

test('an editor deletes their account: two steps, then the login page says it was deleted and the account cannot sign in', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const email = `gone+${suffix}@example.com`
  await login(page)
  await openSite(page, ACME_SITE)
  const { context, guest } = await inviteAndJoin(browser, page, {
    email,
    name: 'Leaving Person',
  })

  await guest.goto('/account')
  await hydrated(guest, guest.getByTestId('account-page'))
  await guest.getByTestId('delete-account').click()
  const dialog = guest.getByTestId('delete-account-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Content you wrote stays')
  await expect(dialog).toContainText('Deleted user')

  // Step 1: the continue button waits for the exact email.
  const continueButton = guest.getByTestId('delete-account-continue')
  await expect(continueButton).toBeDisabled()
  await guest.getByTestId('delete-account-email').fill('someone@else.example')
  await expect(continueButton).toBeDisabled()
  await guest.getByTestId('delete-account-email').fill(email)
  await expect(continueButton).toBeEnabled()
  await continueButton.click()

  // Step 2: the password. A wrong one is refused inline and nothing is deleted.
  await expect(dialog).toContainText('Confirm it')
  await dialog
    .getByLabel('Password', { exact: true })
    .fill('wrong password here')
  await guest.getByTestId('delete-account-confirm').click()
  await expect(guest.getByText('That password is not correct.')).toBeVisible()
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await guest.getByTestId('delete-account-confirm').click()
  await expect(guest).toHaveURL(/\/login\?deleted=1/, { timeout: 60_000 })
  await expect(guest.getByTestId('auth-notice')).toHaveText(
    'Your account was deleted.',
  )

  // The deleted person cannot sign in again.
  await trySignIn(guest, email, PASSWORD)
  await expect(guest).toHaveURL(/\/login/)
  await expect(guest.getByTestId('auth-error')).toBeVisible()
  await context.close()
})

test('a blocked account is told to contact its agency, both at the password form and after a provider callback', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const email = `blocked+${suffix}@example.com`
  await login(page)
  await openSite(page, ACME_SITE)
  const { context } = await inviteAndJoin(browser, page, {
    email,
    name: 'Blocked Person',
  })
  await context.close()

  await blockInDatabase(email)

  const fresh = await browser.newContext()
  const visitor = await fresh.newPage()
  await visitor.goto('/login')
  await trySignIn(visitor, email, PASSWORD)
  await expect(visitor.getByTestId('auth-error')).toHaveText(
    'This account is blocked. Contact your agency.',
  )
  await expect(visitor).toHaveURL(/\/login/)

  // A provider round trip that the block refused comes back as ?error=.
  await visitor.goto('/login?error=ACCOUNT_BLOCKED')
  await expect(visitor.getByTestId('auth-error')).toHaveText(
    'This account is blocked. Contact your agency.',
  )
  await fresh.close()
})

test('the account page fits a 390px screen and the danger zone is reachable', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  await login(page)
  await openSite(page, ACME_SITE)
  const { context, guest } = await inviteAndJoin(browser, page, {
    email: `phone+${suffix}@example.com`,
    name: 'Phone Person',
  })

  // The admin works at desktop size; the person being checked is on a phone.
  await guest.setViewportSize({ width: 390, height: 844 })
  await guest.goto('/account')
  await hydrated(guest, guest.getByTestId('account-page'))
  await expect(guest.getByTestId('account-name-input')).toBeVisible()
  await expect(guest.getByTestId('change-password-form')).toBeVisible()

  // Nothing wider than the screen: no sideways scrolling.
  const overflow = await guest.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  const deleteButton = guest.getByTestId('delete-account')
  await deleteButton.scrollIntoViewIfNeeded()
  await expect(deleteButton).toBeVisible()
  await deleteButton.click()
  await expect(guest.getByTestId('delete-account-dialog')).toBeVisible()
  await guest.keyboard.press('Escape')
  await expect(guest.getByTestId('delete-account-dialog')).toBeHidden()
  await context.close()
})
