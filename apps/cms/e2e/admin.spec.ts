import { expect, test } from '@playwright/test'

import {
  createSiteOnClientPage,
  expectToast,
  login,
  openAgency,
  slugify,
  uniqueSuffix,
} from './helpers'

test('agency admin sets up a client, a site, its content model and invites people', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const suffix = uniqueSuffix()
  const clientName = `E2E Client ${suffix}`
  const clientSlug = slugify(clientName)
  const inviteEmail = `someone+${suffix}@example.com`

  await login(page)

  /* Agency › Clients › New client (a sheet; the slug is suggested). */
  await openAgency(page)
  await page.getByTestId('sidebar').getByTestId('clients-nav').click()
  await expect(page).toHaveURL(/\/agency\/clients$/)
  await expect(page.getByTestId('organizations-page')).toBeVisible()
  await page.getByTestId('new-organization').first().click()
  const clientSheet = page.getByTestId('new-client-sheet')
  await expect(clientSheet).toBeVisible()
  await page.getByTestId('org-name').fill(clientName)
  await expect(page.getByTestId('org-slug')).toHaveValue(clientSlug)
  await page.getByTestId('create-client').click()
  await expectToast(page, 'Client created')

  /* The client page: name, slug whisper, tabs. */
  await expect(page).toHaveURL(/\/agency\/clients\/[^/?]+/)
  await expect(page.getByTestId('organization-page')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: clientName, level: 1 }),
  ).toBeVisible()
  await expect(page.getByTestId('client-slug')).toHaveText(clientSlug)
  for (const tab of ['Sites', 'People', 'Deployment', 'Settings']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible()
  }

  /* New site: two steps, the token is revealed once. */
  const site = await createSiteOnClientPage(page, suffix)
  const card = page.getByTestId(`client-site-${site.siteSlug}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText(site.siteName)

  /* Site settings: horizontal tabs; deployment target save pill. */
  await card.getByTestId(`site-settings-${site.siteSlug}`).click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\/settings/)
  await expect(page.getByTestId('site-settings')).toBeVisible()
  await expect(page.getByTestId('site-header-slug')).toHaveText(site.siteSlug)
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTestId('settings-site-name')).toHaveValue(
    site.siteName,
  )

  await page.getByRole('tab', { name: 'Deployment' }).click()
  await expect(page).toHaveURL(/[?&]tab=deployment/)
  await expect(page.getByTestId('settings-deployment')).toBeVisible()
  await expect(page.getByTestId('settings-save-bar')).toBeHidden()
  await page.getByTestId('application-id').fill(`dokploy-app-${suffix}`)
  await page
    .getByTestId('health-check-url')
    .fill(`${site.productionUrl}/health`)
  await expect(page.getByTestId('settings-save-bar')).toBeVisible()
  await page.getByTestId('save-deployment-target').click()
  await expectToast(page, 'Deployment target updated')
  await expect(page.getByTestId('settings-save-bar')).toBeHidden()
  await expect(page.getByTestId('deployment-state')).toContainText(
    `dokploy-app-${suffix}`,
  )
  await expect(page.getByTestId('stop-deploying')).toBeVisible()

  await page.getByRole('tab', { name: 'Developer' }).click()
  await expect(page.getByTestId('settings-developer')).toBeVisible()
  await expect(page.getByTestId('settings-site-slug')).toHaveValue(
    site.siteSlug,
  )

  /* Content model: the schema editor sheet. */
  await page.getByRole('tab', { name: 'Content' }).click()
  await expect(page).toHaveURL(/[?&]tab=content/)
  await expect(page.getByTestId('content-types')).toBeVisible()
  await page.getByTestId('new-content-type').first().click()
  const drawer = page.getByTestId('collection-drawer')
  await expect(drawer).toBeVisible()
  // Create mode starts on Settings.
  await expect(page.getByTestId('schema-tab-settings')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByTestId('collection-route').fill('/pages/$slug')
  await page.getByTestId('save-collection').click()
  await expect(
    drawer.getByText('Enter a name for the content type.'),
  ).toBeVisible()
  await page.getByTestId('collection-label').fill('Pages')
  // The key follows the label while it is new.
  await expect(page.getByTestId('collection-key')).toHaveValue('pages')

  // Closing with unsaved changes asks first.
  await page.keyboard.press('Escape')
  const discard = page.getByRole('alertdialog')
  await expect(
    discard.getByRole('heading', { name: 'Unsaved content type changes' }),
  ).toBeVisible()
  await discard.getByRole('button', { name: 'Keep editing' }).click()
  await expect(discard).toBeHidden()
  await expect(page.getByTestId('collection-label')).toHaveValue('Pages')

  // Fields: the slug row is locked and cannot be removed.
  await page.getByTestId('schema-tab-fields').click()
  const slugRow = page.getByTestId('field-row-0')
  await expect(slugRow).toHaveAttribute('data-locked', 'true')
  await expect(page.getByTestId('field-key-0')).toHaveText('slug')
  await expect(
    slugRow.getByRole('button', { name: 'Remove field' }),
  ).toHaveCount(0)

  // A text field without a label does not save.
  await page.getByTestId('add-field').click()
  await expect(page.getByTestId('field-type-picker')).toBeVisible()
  await page.getByTestId('field-type-tile-text').click()
  await expect(page.getByTestId('field-form')).toBeVisible()
  await page.getByTestId('save-collection').click()
  await expect(drawer.getByText('Enter a label for this field.')).toBeVisible()
  await page.getByTestId('field-label-1').fill('Title')
  await expect(page.getByTestId('field-key-1')).toHaveValue('title')
  await page.getByTestId('field-required-1').click()
  await page.getByTestId('field-back').click()

  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-richtext').click()
  await page.getByTestId('field-label-2').fill('Body')
  await expect(page.getByTestId('field-key-2')).toHaveValue('body')
  await page.getByTestId('field-back').click()
  await expect(page.getByTestId('field-list')).toBeVisible()
  await expect(page.getByTestId('field-key-1')).toHaveText('title')
  await expect(page.getByTestId('field-key-2')).toHaveText('body')

  await page.getByTestId('save-collection').click()
  await expectToast(page, 'Content type saved')
  // Creating a content type opens its (empty) collection.
  await expect(page).toHaveURL(/\/c\/pages$/)
  await expect(page.getByTestId('collection-empty')).toBeVisible()
  const sidebarPages = page
    .getByTestId('sidebar')
    .getByTestId('collection-pages')
  await expect(sidebarPages).toBeVisible()

  // Turn it off from the Content tab; the sidebar greys it with "Off".
  await page.getByTestId('sidebar').getByTestId('settings-nav').click()
  await page.getByRole('tab', { name: 'Content' }).click()
  const row = page.getByTestId('content-type-pages')
  await expect(row).toBeVisible()
  await expect(row).toContainText('/pages/$slug')
  await expect(row).toContainText('3 fields')
  const enabled = page.getByTestId('content-type-enabled-pages')
  await expect(enabled).toHaveAttribute('aria-checked', 'true')
  await enabled.click()
  await expectToast(page, 'Pages turned off')
  await expect(enabled).toHaveAttribute('aria-checked', 'false')
  await expect(row.getByText('Off', { exact: true })).toBeVisible()
  await expect(sidebarPages.getByText('Off', { exact: true })).toBeVisible()

  // Delete is type-to-confirm.
  await row.click()
  await expect(drawer).toBeVisible()
  await page.getByTestId('schema-tab-settings').click()
  await page.getByTestId('delete-collection').click()
  const confirmAction = page.getByTestId('confirm-action')
  await expect(confirmAction).toBeDisabled()
  await page.getByTestId('confirm-text').fill('page')
  await expect(confirmAction).toBeDisabled()
  await page.getByTestId('confirm-text').fill('pages')
  await confirmAction.click()
  await expectToast(page, 'Content type deleted')
  await expect(row).toHaveCount(0)
  await expect(sidebarPages).toHaveCount(0)

  /* People: invite an owner through the invite sheet. */
  await page.getByTestId('sidebar').getByTestId('team-nav').click()
  await expect(page.getByTestId('people-page')).toBeVisible()
  await page.getByTestId('invite-member').click()
  const inviteSheet = page.getByTestId('invite-sheet')
  await expect(inviteSheet).toBeVisible()
  await page.getByTestId('invite-email').fill(inviteEmail)
  await expect(page.getByTestId('invite-role-editor')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByTestId('invite-role-owner').click()
  await expect(page.getByTestId('invite-role-owner')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByTestId('invite-send').click()
  await expectToast(page, 'Invitation sent')
  await expect(inviteSheet).toBeHidden()
  const invitation = page.getByTestId(`invitation-row-${inviteEmail}`)
  await expect(invitation).toBeVisible()
  await expect(invitation).toContainText('Owner')

  /* Agency › Activity shows what just happened. */
  await openAgency(page)
  await page.getByTestId('sidebar').getByTestId('agency-activity-nav').click()
  await expect(page).toHaveURL(/\/agency\/activity/)
  const log = page.getByTestId('agency-activity')
  await expect(log).toBeVisible()
  await expect(
    log.getByTestId('activity-item').filter({ hasText: clientName }).first(),
  ).toBeVisible()
  await expect(
    log
      .getByTestId('activity-item')
      .filter({ hasText: 'added the client' })
      .first(),
  ).toBeVisible()
  await expect(
    log.getByTestId('activity-item').filter({ hasText: inviteEmail }).first(),
  ).toBeVisible()
})
