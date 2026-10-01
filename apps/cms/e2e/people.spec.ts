import { expect, test } from '@playwright/test'

import {
  PASSWORD,
  authForm,
  createSiteOnClientPage,
  expectToast,
  hydrated,
  login,
  openAgency,
  slugify,
  uniqueSuffix,
  waitForInviteLink,
} from './helpers'

test('invite several people, accept by e-mail, change a role and revoke', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const clientName = `E2E People ${suffix}`
  const [first, second, third] = ['first', 'second', 'third'].map(
    (who) => `${who}+${suffix}@example.com`,
  )

  // A client of its own, so role changes never touch the seeded people.
  await login(page)
  await openAgency(page)
  await page.getByTestId('sidebar').getByTestId('clients-nav').click()
  await page.getByTestId('new-organization').first().click()
  await page.getByTestId('org-name').fill(clientName)
  await page.getByTestId('create-client').click()
  await expect(page.getByTestId('client-slug')).toHaveText(slugify(clientName))
  const site = await createSiteOnClientPage(page, suffix, 'E2E People Site')
  await page.getByTestId(`open-site-${site.siteSlug}`).click()
  await expect(page.getByTestId('site-overview')).toBeVisible()

  await page.getByTestId('sidebar').getByTestId('team-nav').click()
  await expect(page.getByTestId('people-page')).toBeVisible()
  await expect(page.getByTestId('people-manage-in-agency')).toBeVisible()

  /* Several addresses at once, sent one after another. */
  await page.getByTestId('invite-member').click()
  const sheet = page.getByTestId('invite-sheet')
  await expect(sheet).toBeVisible()
  await page.getByTestId('invite-email').fill(`${first}, ${second}`)
  await expect(page.getByTestId('invite-send')).toHaveText(/Send 2 invitations/)
  await page.getByTestId('invite-send').click()
  await expectToast(page, '2 invitations sent')
  await expect(sheet).toBeHidden()
  const pending = page.getByTestId('pending-invitations')
  await expect(pending.getByTestId(`invitation-row-${first}`)).toBeVisible()
  await expect(pending.getByTestId(`invitation-row-${second}`)).toBeVisible()
  await expect(pending.getByTestId(`invitation-row-${first}`)).toContainText(
    'Editor',
  )

  /* Results per address: one is already pending, one goes out. */
  await page.getByTestId('invite-member').click()
  await page.getByTestId('invite-email').fill(`${second}, ${third}`)
  await page.getByTestId('invite-send').click()
  const results = page.getByTestId('invite-results')
  await expect(results).toBeVisible()
  await expect(results).toContainText("Some invitations weren't sent")
  await expect(results.getByRole('listitem').filter({ hasText: third })).toContainText('Sent')
  await expect(
    results.getByRole('listitem').filter({ hasText: second }),
  ).toContainText('already pending')
  // Only the address that needs another look stays in the field.
  await expect(page.getByTestId('invite-email')).toHaveValue(second)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(pending.getByTestId(`invitation-row-${third}`)).toBeVisible()

  /* The invitee follows the e-mailed link and joins in one step. */
  const link = await waitForInviteLink(first)
  const invitee = await browser.newContext()
  const guest = await invitee.newPage()
  await guest.goto(link)
  await expect(guest.getByRole('heading', { name: `${clientName} invited you` })).toBeVisible()
  await expect(guest.getByText('You\'ll join as an Editor')).toBeVisible()
  await authForm(guest)
  await expect(guest.getByTestId('invite-email')).toHaveValue(first)
  await guest.getByLabel('Name').fill('First Invitee')
  await guest.getByLabel('Password').fill(PASSWORD)
  await guest.getByRole('button', { name: 'Create account and join' }).click()
  await expect(guest).toHaveURL(/\/sites\/[^/]+/)
  await expect(guest.getByTestId('site-overview')).toBeVisible()
  await invitee.close()

  /* Back as the admin: the new member is listed; promote them. */
  await page.reload()
  await hydrated(page)
  const member = page.getByTestId(`member-row-${first}`)
  await expect(member).toBeVisible()
  await expect(member).toContainText('First Invitee')
  await expect(pending.getByTestId(`invitation-row-${first}`)).toHaveCount(0)
  const role = page.getByTestId(`member-role-${first}`)
  await expect(role.getByRole('radio', { name: 'Editor' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await role.getByRole('radio', { name: 'Owner' }).click()
  await expectToast(page, 'Role changed to owner')
  await expect(role.getByRole('radio', { name: 'Owner' })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  /* Revoke an invitation (with a confirm). */
  await pending
    .getByTestId(`invitation-row-${third}`)
    .getByTestId('invitation-revoke')
    .click()
  await page.getByTestId('confirm-action').click()
  await expectToast(page, 'Invitation revoked')
  await expect(pending.getByTestId(`invitation-row-${third}`)).toHaveCount(0)
})
