import { expect, test } from '@playwright/test'

import { TINY_PNG, login } from './helpers'

test('owner can author, publish, and release an article', async ({ page }) => {
  test.setTimeout(90_000)
  const title = `E2E Article ${Date.now()}`
  const expectedSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  await login(page, 'owner@acme.local')
  await page.getByTestId('sites-nav').getByRole('link', { name: /acme-site/i }).click()
  await expect(page.getByTestId('release-status')).toBeVisible()

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
  await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('entry-status')).toHaveText('draft', { timeout: 15_000 })
  await expect(page).toHaveURL(/\/c\/articles\/(?!new(?:\/|$))[^/]+$/, {
    timeout: 15_000,
  })

  await page.getByTestId('publish-menu').click()
  await expect(page.getByTestId('publish-now')).not.toHaveAttribute(
    'data-disabled',
  )
  await page.getByTestId('publish-now').click()
  await expect(page.getByTestId('entry-status')).toHaveText('published', {
    timeout: 15_000,
  })

  await page.evaluate(() => {
    const original = window.open
    window.open = (url?: string | URL, target?: string, features?: string) => {
      ;(window as unknown as { __previewUrl?: string }).__previewUrl = String(
        url ?? '',
      )
      return original.call(window, url, target, features)
    }
  })
  await page.getByTestId('preview-entry').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as unknown as { __previewUrl?: string }).__previewUrl ?? '',
      ),
    )
    .toContain('/__preview/articles/')

  await page.getByRole('link', { name: 'Content' }).click()
  await page.getByTestId('publish-site').click()
  await expect(page.getByTestId('release-live')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'Releases' }).click()
  await expect(page.getByText('live', { exact: true }).first()).toBeVisible()
})
