import { expect, test } from '@playwright/test'

import { login } from './helpers'

test('agency admin can create an org, site, collection, and invitation', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const ts = Date.now()
  const orgName = `E2E Org ${ts}`
  const orgSlug = `e2e-org-${ts}`
  const siteName = `E2E Site ${ts}`
  const siteSlug = `e2e-site-${ts}`
  const productionUrl = `https://e2e-${ts}.example.com`
  const inviteEmail = `someone+${ts}@example.com`

  await login(page)
  await page.goto('/admin/organizations')
  await expect(
    page.getByRole('heading', { name: 'Organizations' }),
  ).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()

  await page.getByTestId('new-organization').click()
  await expect(page.getByTestId('org-name')).toBeVisible()
  await page.getByTestId('org-name').fill(orgName)
  await expect(page.getByTestId('org-slug')).toHaveValue(orgSlug)
  await page.getByRole('button', { name: 'Create organization' }).click()
  await expect(page).toHaveURL(/\/admin\/organizations\/[^/]+$/, {
    timeout: 15_000,
  })
  const orgId = page.url().split('/').pop()
  expect(orgId).toBeTruthy()

  await page.getByTestId('new-site').click()
  await page.getByTestId('site-name').fill(siteName)
  await expect(page.getByTestId('site-slug')).toHaveValue(siteSlug)
  await page.getByTestId('site-production-url').fill(productionUrl)
  await page.getByRole('button', { name: 'Create site' }).click()

  const tokenAlert = page.getByTestId('site-token-alert')
  await expect(tokenAlert).toBeVisible({ timeout: 15_000 })
  await expect(tokenAlert).toContainText('ARECA_SITE_TOKEN')
  await expect(page.getByTestId('site-token-value')).not.toHaveText('')

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\/settings/, { timeout: 15_000 })

  await page.getByTestId('application-id').fill(`dokploy-app-${ts}`)
  await page.getByTestId('health-check-url').fill(`${productionUrl}/health`)
  await page.getByTestId('save-deployment-target').click()
  await expect(page.getByText('Deployment target updated')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByTestId('add-collection').click()
  await page.getByTestId('collection-key').fill('pages')
  await page.getByTestId('collection-label').fill('Pages')
  await page.getByTestId('collection-route').fill('/pages/$slug')
  await page.getByTestId('field-key-0').fill('title')
  await page.getByTestId('field-label-0').fill('Title')
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-key-1').fill('body')
  await page.getByTestId('field-label-1').fill('Body')
  await page.getByTestId('field-type-1').click()
  await page.getByRole('option', { name: 'richtext' }).click()
  await page.getByTestId('save-collection').click()
  await expect(
    page.getByRole('cell', { name: 'pages', exact: true }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('cell', { name: '2', exact: true })).toBeVisible()

  const collectionRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'pages', exact: true }) })
  await collectionRow.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByText('Enabled', { exact: true }).click()
  await page.getByTestId('save-collection').click()
  await expect(
    collectionRow.getByText('Disabled', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByTestId('site-nav').getByText('Disabled', { exact: true }),
  ).toBeVisible()

  await collectionRow.getByRole('button', { name: 'Delete' }).click()
  const confirmAction = page.getByTestId('confirm-action')
  await expect(confirmAction).toBeDisabled()
  await page.getByTestId('confirm-text').fill('pages')
  await confirmAction.click()
  await expect(page.getByText('Collection deleted')).toBeVisible({
    timeout: 15_000,
  })
  await expect(collectionRow).toHaveCount(0)

  await page.goto(`/admin/organizations/${orgId}`)
  await page.getByRole('tab', { name: 'Members' }).click()
  await page.getByTestId('invite-member').click()
  await page.getByTestId('invite-email').fill(inviteEmail)
  await page.locator('#invite-role').click()
  await page.getByRole('option', { name: 'owner', exact: true }).click()
  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText('Invitation sent')).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByTestId('pending-invitations').getByText(inviteEmail),
  ).toBeVisible()

  await page.goto('/admin/audit')
  await expect(
    page.getByRole('cell', { name: 'Created organization' }).first(),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByRole('cell', { name: orgName, exact: true }).first(),
  ).toBeVisible()
})
