import { expect, test } from '@playwright/test'

import { TINY_PNG, login, openSite, uniqueSuffix, waitForSavedDraft } from './helpers'

test('owner can author, publish, and release an article', async ({ page }) => {
  test.setTimeout(90_000)
  const title = `E2E Article ${uniqueSuffix()}`
  const expectedSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  await login(page, 'owner@acme.local')
  await openSite(page, /acme-site/i)

  await page.getByTestId('collection-articles').getByRole('link', { name: 'Open' }).click()
  await page.getByTestId('new-entry').click()

  await page.getByLabel(/Title/).fill(title)
  await expect(page.getByLabel(/Slug/)).toHaveValue(expectedSlug)

  await page.getByTestId('rich-text-editor').click()
  await page.keyboard.type('Hello from the e2e editor')

  await page.getByRole('button', { name: 'Choose' }).click()
  await expect(page.getByTestId('media-picker')).toBeVisible()
  const upload = page.getByTestId('media-upload')
  await upload.setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  await expect(page.getByTestId('image-field-thumb')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'draft',
  )

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

  await page.getByRole('link', { name: 'Content' }).click()
  await page.getByTestId('publish-site').click()
  await expect(page.getByTestId('release-live')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'Releases' }).click()
  await expect(page.getByText('live', { exact: true }).first()).toBeVisible()
})
