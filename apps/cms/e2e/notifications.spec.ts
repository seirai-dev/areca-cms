import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { OWNER, hydrated, login, openAgency, openClient } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The agency default for owners on "A release failed", locked or not. */
const DEFAULT_LOCK = 'rule-release.failed-owner-lock'
const DEFAULT_SWITCH = 'rule-release.failed-owner-switch'

async function openMailDefaults(page: Page) {
  await login(page)
  await openAgency(page)
  await page.getByTestId('agency-mail-nav').click()
  await expect(page).toHaveURL(/\/agency\/mail$/)
  await expect(page.getByTestId('mail-settings-page')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await hydrated(page, page.getByTestId('mail-settings-page'))
  const defaults = page.locator('#client-notifications')
  await expect(defaults.getByTestId('rules-matrix')).toBeVisible()
  return defaults
}

test('agency requires a default email for owners and it saves per change', async ({
  page,
}) => {
  const defaults = await openMailDefaults(page)

  const lock = defaults.getByTestId(DEFAULT_LOCK)
  await lock.click()
  await expect(lock).toHaveAttribute('aria-pressed', 'true')
  await expect(defaults.getByTestId(DEFAULT_SWITCH)).toBeDisabled()

  // Saved on the server, not held in the mail form's save bar.
  await page.reload()
  await hydrated(page, page.getByTestId('mail-settings-page'))
  await expect(
    page.locator('#client-notifications').getByTestId(DEFAULT_LOCK),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('owner sees the required email locked and can still change their own', async ({
  page,
}) => {
  await login(page, OWNER)
  await page.goto('/account')
  await expect(page.getByTestId('account-page')).toBeVisible()
  await hydrated(page, page.getByTestId('account-page'))

  const section = page.locator('#notifications')
  await expect(section).toBeVisible()

  const required = section
    .getByRole('switch', { name: 'A release failed for Owner' })
    .first()
  await expect(required).toBeChecked()
  await expect(required).toBeDisabled()
  await expect(section.getByText(/Required by/).first()).toBeVisible()

  const optional = section
    .getByRole('switch', { name: "Someone else's release went live for Owner" })
    .first()
  await expect(optional).not.toBeChecked()
  await optional.click()
  await expect(optional).toBeChecked()

  await page.reload()
  await hydrated(page, page.getByTestId('account-page'))
  await expect(
    page
      .locator('#notifications')
      .getByRole('switch', {
        name: "Someone else's release went live for Owner",
      })
      .first(),
  ).toBeChecked()

  // Put it back so the seeded owner keeps the default.
  await page
    .locator('#notifications')
    .getByRole('switch', { name: "Someone else's release went live for Owner" })
    .first()
    .click()
  await expect(optional).not.toBeChecked()
})

test('agency admin unlocks the default and sets a rule for one client', async ({
  page,
}) => {
  const defaults = await openMailDefaults(page)
  const lock = defaults.getByTestId(DEFAULT_LOCK)
  await lock.click()
  await expect(lock).toHaveAttribute('aria-pressed', 'false')

  await openClient(page, 'Acme', 'acme')
  await page.getByTestId('client-tab-settings').click()

  const org = page.getByTestId('org-notifications')
  await expect(org).toBeVisible()
  await expect(org.getByTestId('rules-matrix')).toBeVisible()

  // Changing a cell marks it as set here; Reset puts the inherited value back.
  const cell = org.getByTestId('rule-release.live-editor-switch')
  const before = await cell.isChecked()
  await cell.click()
  await expect(cell).toBeChecked({ checked: !before })

  const reset = org.getByTestId('rule-release.live-editor-reset')
  await expect(reset).toBeVisible()
  await reset.click()
  await expect(reset).toHaveCount(0)
  await expect(cell).toBeChecked({ checked: before })
})

test('an invalid unsubscribe link explains itself and offers sign-in', async ({
  page,
}) => {
  await page.goto('/unsubscribe?token=not-a-real-token')
  const invalid = page.getByTestId('unsubscribe-invalid')
  await expect(invalid).toBeVisible()
  await expect(invalid).toContainText("This link doesn't work")
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
})
