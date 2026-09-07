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

  await page.reload()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await expect(page.getByTestId('rich-text-editor')).toContainText(
    'Hello from the e2e editor',
  )
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

  await page.getByRole('link', { name: 'Content' }).click()
  await page.getByTestId('publish-site').click()
  await expect(page.getByTestId('release-live')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'Releases' }).click()
  await expect(page.getByText('live', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Acme Owner' })).toBeVisible()
})

test('draft save shows field errors for empty title and invalid slug', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const suffix = uniqueSuffix()
  const { siteName } = await createIsolatedAcmeSite(page, `val-${suffix}`)

  await login(page, 'owner@acme.local')
  await openSite(page, siteName)
  await page.getByTestId('collection-articles').getByRole('link', { name: 'Open' }).click()
  await page.getByTestId('new-entry').click()

  await page.getByLabel(/Slug/).fill('Hello World')
  await page.getByTestId('save-draft').click()
  await expect(page.getByRole('alert').filter({ hasText: /Required|Invalid slug/i }).first()).toBeVisible({
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
  await expect(page.getByRole('alert').filter({ hasText: 'Required' }).first()).toBeVisible({
    timeout: 15_000,
  })

  await page.getByRole('link', { name: /Back to/ }).click()
  await page.getByTestId('new-entry').click()
  await page.getByLabel(/Title/).fill(`Empty body ${suffix}`)
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await page.getByTestId('publish-menu').click()
  await page.getByTestId('publish-now').click()
  await expect(
    page.getByRole('alert').filter({ hasText: /Required|Could not publish/i }).first(),
  ).toBeVisible({ timeout: 15_000 })
})
