import { expect, test } from '@playwright/test'

import {
  TINY_PNG,
  createIsolatedAcmeSite,
  login,
  openSite,
  uniqueSuffix,
  waitForSavedDraft,
} from './helpers'

test('owner can author, publish, and release an article', async ({ page }) => {
  test.setTimeout(90_000)
  const suffix = uniqueSuffix()
  const title = `E2E Article ${suffix}`
  const expectedSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const { siteName } = await createIsolatedAcmeSite(page, `ed-${suffix}`)

  await login(page, 'owner@acme.local')
  await openSite(page, siteName)

  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByTestId('new-entry').click()

  await page.getByLabel(/Title/).fill(title)
  await expect(page.getByLabel(/Slug/)).toHaveValue(expectedSlug)

  await page.getByTestId('rich-text-editor').click()
  await page.keyboard.type('Hello from the e2e editor')
  await page.getByTestId('rich-text-insert-table').click()
  const editorTable = page.getByTestId('rich-text-editor').locator('table')
  await expect(editorTable).toBeVisible()
  await editorTable.locator('th, td').first().click()
  await expect(editorTable.locator('tr')).toHaveCount(3)
  await page.getByTestId('rich-text-add-table-row').click()
  await expect(editorTable.locator('tr')).toHaveCount(4)
  await editorTable.locator('tr').nth(1).locator('th, td').first().click()
  await page.getByTestId('rich-text-delete-table-row').click()
  await expect(editorTable.locator('tr')).toHaveCount(3)
  await page.getByTestId('rich-text-add-table-column').click()
  await expect(editorTable.locator('tr').first().locator('th, td')).toHaveCount(
    4,
  )
  await page.getByTestId('rich-text-delete-table-column').click()
  await expect(editorTable.locator('tr').first().locator('th, td')).toHaveCount(
    3,
  )

  await page.getByRole('button', { name: 'Choose' }).click()
  await expect(page.getByTestId('media-picker')).toBeVisible()
  const upload = page.getByTestId('media-upload')
  await upload.setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  await expect(page.getByTestId('image-field-thumb')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByRole('button', { name: 'Insert image' }).click()
  await expect(page.getByTestId('media-picker')).toBeVisible()
  await page.getByTestId('media-picker').getByTitle('tiny.png').first().click()
  const richImage = page
    .getByTestId('rich-text-editor')
    .locator("[data-resize-container][data-node='image']")
  await expect(richImage).toBeVisible()
  await expect(richImage.locator('[data-resize-handle]')).toHaveCount(4)

  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'draft',
  )

  await page.reload()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await expect(page.getByTestId('rich-text-editor')).toContainText(
    'Hello from the e2e editor',
  )
  await expect(
    page.getByTestId('rich-text-editor').locator('table'),
  ).toBeVisible()
  await expect(
    page
      .getByTestId('rich-text-editor')
      .locator("[data-resize-container][data-node='image']"),
  ).toBeVisible()
  await expect(page.getByTestId('image-field-thumb')).toBeVisible()

  await page.getByTestId('publish-menu').click()
  await expect(page.getByTestId('publish-now')).not.toHaveAttribute(
    'data-disabled',
  )
  await page.getByTestId('publish-now').click()
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 15_000 },
  )

  await page
    .getByRole('link', { name: /Back to/ })
    .click()
  await expect(page.getByTestId('site-nav')).toBeVisible({ timeout: 15_000 })
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Content' })
    .click()
  await page.getByTestId('publish-site').click()
  await expect(page.getByTestId('release-live')).toBeVisible({
    timeout: 30_000,
  })

  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Releases' })
    .click()
  await expect(page.getByText('live', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Acme Owner').first()).toBeVisible()
})

test('draft save shows field errors for empty title and invalid slug', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const suffix = uniqueSuffix()
  const { siteName } = await createIsolatedAcmeSite(page, `val-${suffix}`)

  await login(page, 'owner@acme.local')
  await openSite(page, siteName)
  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByTestId('new-entry').click()

  await page.getByLabel(/Slug/).fill('Hello World')
  await page.getByTestId('save-draft').click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /Required|Invalid slug/i })
      .first(),
  ).toBeVisible({
    timeout: 15_000,
  })

  await page.getByLabel(/Title/).fill(`Valid ${suffix}`)
  await page.getByLabel(/Slug/).fill(`valid-${suffix}`)
  await page.getByTestId('rich-text-editor').click()
  await page.keyboard.type('Body')
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)

  await page.getByLabel(/Title/).fill('')
  await page.getByTestId('save-draft').click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Required' }).first(),
  ).toBeVisible({
    timeout: 15_000,
  })

  await page.getByRole('link', { name: /Back to/ }).click()
  // Unsaved edits (the cleared title) trigger the leave guard.
  await page.getByTestId('discard-changes').click()
  await page.getByTestId('new-entry').click()
  await page.getByLabel(/Title/).fill(`Empty body ${suffix}`)
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await page.getByTestId('publish-menu').click()
  await page.getByTestId('publish-now').click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /Required|Could not publish/i })
      .first(),
  ).toBeVisible({ timeout: 15_000 })
})
