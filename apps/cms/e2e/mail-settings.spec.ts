import { expect, test } from '@playwright/test'

import { ADMIN, expectToast, hydrated, login, openAgency } from './helpers'

test.describe.configure({ mode: 'serial' })

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

/** How many messages Mailpit holds for `to`. */
async function mailpitCount(to: string) {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  )
  const body = (await res.json()) as { messages_count?: number }
  return body.messages_count ?? 0
}

test('agency admin sets up mail, sends a test, and handles a bad port', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await login(page)
  await openAgency(page)
  await page.getByTestId('agency-mail-nav').click()
  await expect(page).toHaveURL(/\/agency\/mail$/)
  await expect(page.getByTestId('mail-settings-page')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await hydrated(page, page.getByTestId('mail-settings-page'))

  // Start from the form: switching the environment setting off only opens it.
  const useEnv = page.getByTestId('mail-use-env')
  if ((await useEnv.getAttribute('data-state')) === 'checked') {
    await useEnv.click()
  }

  await page.getByTestId('mail-host').fill('localhost')
  await page.getByTestId('mail-port').fill('1025')
  await page.getByTestId('mail-secure').click()
  await page.getByTestId('mail-secure-none').click()
  await page.getByTestId('mail-from').fill('cms@areca.local')

  // Verify runs on the unsaved values and sends nothing.
  await page.getByTestId('mail-verify').click()
  await expect(page.getByTestId('mail-verify-result')).toContainText(
    'Connection works',
  )

  // The test email goes to the signed-in admin and shows up in Mailpit.
  const before = await mailpitCount(ADMIN)
  await page.getByTestId('mail-send-test').click()
  await expectToast(page, `Test email sent to ${ADMIN}`)
  await expect
    .poll(() => mailpitCount(ADMIN), { timeout: 30_000 })
    .toBeGreaterThan(before)

  // Saving re-verifies on the server; the values pass, so no confirm dialog.
  await page.getByTestId('save-mail').click()
  await expectToast(page, 'Mail settings saved')
  await expect(page.getByTestId('mail-status')).toContainText(
    'Sending with Mail settings',
  )

  // The test shows in Recent emails as Sent.
  const testRow = page
    .getByTestId('mail-recent-row')
    .filter({ hasText: 'Test email' })
    .first()
  await expect(testRow.getByTestId('mail-recent-status')).toHaveText('Sent')

  // A port nothing listens on: the readable reason, not a raw SMTP error.
  await page.getByTestId('mail-port').fill('1')
  await page.getByTestId('mail-verify').click()
  await expect(page.getByTestId('mail-verify-result')).toContainText(
    "Couldn't reach localhost on port 1",
  )

  // Back to the environment settings (the unsaved port is discarded with the form).
  await page.getByTestId('mail-use-env').click()
  await page.getByTestId('confirm-action').click()
  await expectToast(page, 'Now sending with environment settings')
  await expect(page.getByTestId('mail-status')).toContainText(
    'Sending with environment settings',
  )
})
