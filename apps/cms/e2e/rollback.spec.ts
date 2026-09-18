import { expect, test } from '@playwright/test'

import {
  createAndSaveArticle,
  createIsolatedAcmeSite,
  login,
  openSite,
  uniqueSuffix,
  waitForSavedDraft,
} from './helpers'

test('owner can publish twice and rollback the superseded release', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const suffix = uniqueSuffix()
  const title = `E2E Rollback ${suffix}`
  const { siteName } = await createIsolatedAcmeSite(page, `rb-${suffix}`)

  await login(page, 'owner@acme.local')
  await openSite(page, siteName)
  await createAndSaveArticle(page, title)

  await page.getByTestId('publish-menu').click()
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
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByRole('link', { name: title }).click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await page.getByLabel(/Title/).fill(`${title} v2`)
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
  await page.getByTestId('publish-menu').click()
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
  await expect(page.getByTestId('publication-status-live')).toHaveCount(1, {
    timeout: 30_000,
  })
  await expect(page.getByTestId('publication-status-superseded')).toHaveCount(1)

  await page.getByTestId('publication-menu').click()
  await page.getByTestId('rollback-publication').click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Rollback' })
    .click()
  await expect(page.getByText('Rollback requested')).toBeVisible({
    timeout: 15_000,
  })

  await expect(page.getByTestId('publication-status-live')).toHaveCount(1, {
    timeout: 30_000,
  })
  await expect(page.getByTestId('publication-status-superseded')).toHaveCount(1)
  await expect(page.getByTestId('publication-menu')).toBeVisible()
})
