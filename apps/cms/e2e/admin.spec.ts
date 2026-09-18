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

  await page.getByRole('tab', { name: 'Sites' }).click()
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
  await expect(page.getByTestId('settings-site-slug')).toHaveValue(siteSlug)
  await expect(page.getByTestId('site-header-slug')).toHaveText(siteSlug)

  await page.getByTestId('application-id').fill(`dokploy-app-${ts}`)
  await page.getByTestId('health-check-url').fill(`${productionUrl}/health`)
  await page.getByTestId('save-deployment-target').click()
  await expect(page.getByText('Site updated')).toBeVisible({
    timeout: 15_000,
  })

  // Collections are managed on the site's Content tab.
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Content' })
    .click()
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  // The collection drawer opens on Settings in create mode.
  await page.getByTestId('add-collection').click()
  await page.getByTestId('collection-key').fill('pages')
  await page.getByTestId('collection-route').fill('/pages/$slug')
  await page.getByTestId('save-collection').click()
  await expect(page.getByText('Enter a collection label.')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByTestId('collection-label').fill('Pages')

  await page.keyboard.press('Escape')
  await expect(
    page
      .getByRole('alertdialog')
      .getByRole('heading', { name: 'Unsaved collection changes' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByTestId('collection-label')).toBeVisible()

  // Schema lives on the drawer's Fields segment; the slug row is locked.
  await page.getByRole('tab', { name: 'Fields' }).click()
  await expect(page.getByTestId('field-row-0')).toHaveAttribute(
    'data-locked',
    'true',
  )
  await expect(page.getByTestId('field-key-0')).toHaveText('slug')
  await expect(page.getByTestId('field-label-0')).toHaveText('Slug')
  await expect(page.getByTestId('field-type-0')).toHaveText('slug')
  await expect(
    page
      .getByTestId('field-row-0')
      .getByRole('button', { name: 'Remove field' }),
  ).toHaveCount(0)

  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-text').click()
  await page.getByTestId('field-key-1').fill('title')
  await page.getByTestId('save-collection').click()
  await expect(page.getByText('Enter a label for this field.')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByTestId('field-label-1').fill('Title')
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-richtext').click()
  await page.getByTestId('field-key-2').fill('body')
  await page.getByTestId('field-label-2').fill('Body')
  await page.getByTestId('save-collection').click()

  // Saving a new collection closes the drawer and selects it in the rail.
  const collectionRow = page.getByTestId('collection-pages')
  await expect(collectionRow).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/c\/pages$/, { timeout: 15_000 })

  await collectionRow.getByTestId('collection-menu').click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page.getByTestId('collection-label')).toHaveValue('Pages')
  await page.getByRole('switch').click()
  await page.getByTestId('save-collection').click()
  await expect(page.getByText('Collection saved')).toBeVisible({
    timeout: 15_000,
  })
  await expect(collectionRow.getByText('Disabled', { exact: true })).toBeVisible(
    { timeout: 15_000 },
  )

  await page.getByTestId('delete-collection').click()
  const confirmAction = page.getByTestId('confirm-action')
  await expect(confirmAction).toBeDisabled()
  await page.getByTestId('confirm-text').fill('pages')
  await confirmAction.click()
  await expect(page.getByText('Collection deleted')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
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
  await expect(page.getByText('Created organization').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByTestId('audit-log').getByText(orgName).first(),
  ).toBeVisible()
})
