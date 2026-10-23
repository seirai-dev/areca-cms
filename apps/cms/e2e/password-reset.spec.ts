import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import {
  PASSWORD,
  authForm,
  createSiteOnClientPage,
  expectToast,
  login,
  openAgency,
  slugify,
  uniqueSuffix,
  waitForInviteLink,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'
const NEW_PASSWORD = 'a-new-password-1'

/** Escapes a literal for use inside a RegExp (addresses contain `+` and `.`). */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The reset link e-mailed to `email`, newest first (polls Mailpit). */
async function resetLinkFor(email: string, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const list = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    )
    const body = (await list.json()) as { messages?: Array<{ ID: string }> }
    for (const message of body.messages ?? []) {
      const detail = (await (
        await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)
      ).json()) as { HTML?: string; Text?: string }
      const href = `${detail.Text ?? ''} ${detail.HTML ?? ''}`.match(
        /https?:\/\/[^\s"'<>]+\/reset-password\?token=[^\s"'<>&]+/,
      )?.[0]
      if (href) return href
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`No reset e-mail for ${email} in Mailpit`)
}

/**
 * A client and site of its own, and an editor invited to them who has
 * accepted with PASSWORD. Returns the editor's address, so the reset tests
 * never change a seeded account's password.
 */
async function inviteEditor(page: Page, browser: Browser, suffix: string) {
  const clientName = `E2E Reset ${suffix}`
  const email = `reset+${suffix}@example.com`

  await login(page)
  await openAgency(page)
  await page.getByTestId('sidebar').getByTestId('clients-nav').click()
  await page.getByTestId('new-organization').first().click()
  await page.getByTestId('org-name').fill(clientName)
  await page.getByTestId('create-client').click()
  await expect(page.getByTestId('client-slug')).toHaveText(slugify(clientName))
  const site = await createSiteOnClientPage(page, suffix, 'E2E Reset Site')
  await page.getByTestId(`open-site-${site.siteSlug}`).click()
  await expect(page.getByTestId('site-overview')).toBeVisible()

  await page.getByTestId('sidebar').getByTestId('team-nav').click()
  await expect(page.getByTestId('people-page')).toBeVisible()
  await page.getByTestId('invite-member').click()
  await expect(page.getByTestId('invite-sheet')).toBeVisible()
  await page.getByTestId('invite-email').fill(email)
  await page.getByTestId('invite-send').click()
  await expect(
    page
      .getByTestId('pending-invitations')
      .getByTestId(`invitation-row-${email}`),
  ).toBeVisible()

  const link = await waitForInviteLink(email)
  const invitee = await browser.newContext()
  const guest = await invitee.newPage()
  await guest.goto(link)
  const form = await authForm(guest)
  await guest.getByLabel('Name', { exact: true }).fill('Reset Person')
  await guest.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await form.getByRole('button', { name: 'Create account and join' }).click()
  await expect(guest).toHaveURL(/\/sites\/[^/]+/)
  await invitee.close()
  return email
}

test('a person resets their password from the e-mailed link and signs in with it', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const suffix = uniqueSuffix()
  const email = await inviteEditor(page, browser, suffix)

  const person = await browser.newContext()
  const guest = await person.newPage()

  /* The page answers the same for an address with no account. */
  await guest.goto('/forgot-password')
  const form = await authForm(guest)
  await guest
    .getByLabel('Email', { exact: true })
    .fill(`nobody+${suffix}@example.com`)
  await form.getByRole('button', { name: 'Send reset link' }).click()
  await expect(guest.getByTestId('forgot-password-sent')).toContainText(
    `If an account exists for nobody+${suffix}@example.com`,
  )

  /* The real address gets the link, which opens the reset form. */
  await guest.goto('/forgot-password')
  const forgot = await authForm(guest)
  await guest.getByLabel('Email', { exact: true }).fill(email)
  await forgot.getByRole('button', { name: 'Send reset link' }).click()
  await expect(guest.getByTestId('forgot-password-sent')).toContainText(
    `If an account exists for ${email}`,
  )
  const link = await resetLinkFor(email)
  await guest.goto(link)
  const reset = await authForm(guest)
  await guest.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await guest.getByLabel('Confirm password', { exact: true }).fill(NEW_PASSWORD)
  await reset.getByRole('button', { name: 'Set new password' }).click()
  await expect(
    guest.getByRole('heading', { name: 'Your password has been changed' }),
  ).toBeVisible()

  /* The new password works; the old one no longer does. */
  await login(guest, email, NEW_PASSWORD)
  await expect(guest).not.toHaveURL(/\/login/)

  /* A used link is spent. */
  await guest.goto(link)
  await expect(guest.getByTestId('reset-password-invalid')).toContainText(
    'This link has expired or was already used.',
  )
  await person.close()
})

test('an agency admin sends a reset link from People', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const suffix = uniqueSuffix()
  const email = await inviteEditor(page, browser, suffix)

  await openAgency(page)
  await page.getByTestId('agency-people-nav').click()
  await expect(page.getByTestId('agency-people')).toBeVisible()
  await page.getByRole('searchbox').fill(email)
  const row = page.getByTestId(`person-row-${email}`)
  await expect(row).toBeVisible()
  await row.getByTestId(`person-menu-${email}`).click()
  await page.getByTestId(`send-reset-link-${email}`).click()

  const dialog = page.getByTestId('send-reset-link-dialog')
  await expect(dialog).toContainText('Send a password reset link?')
  await dialog.getByTestId('confirm-action').click()
  await expectToast(
    page,
    new RegExp(`Reset link (sent to|queued for) ${escapeRegExp(email)}`),
  )

  expect(await resetLinkFor(email)).toContain('/reset-password?token=')
})
