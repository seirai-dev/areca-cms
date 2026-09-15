import { expect, test } from '@playwright/test'

import {
  createAndSaveArticle,
  createIsolatedAcmeSite,
  datetimeLocalMinutesAgo,
  login,
  openSite,
  uniqueSuffix,
} from './helpers'

test('owner can schedule a past article and the worker publishes it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const suffix = uniqueSuffix()
  const title = `E2E Scheduled ${suffix}`
  const { siteName } = await createIsolatedAcmeSite(page, `sched-${suffix}`)

  await login(page, 'owner@acme.local')
  await openSite(page, siteName)
  await createAndSaveArticle(page, title)

  await page.getByTestId('publish-menu').click()
  await expect(page.getByTestId('schedule-entry')).not.toHaveAttribute(
    'data-disabled',
  )
  await page.getByTestId('schedule-entry').click()
  await page.getByTestId('schedule-at').fill(datetimeLocalMinutesAgo(1))
  await page.getByTestId('schedule-confirm').click()
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'scheduled',
    { timeout: 15_000 },
  )

  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 20_000 },
  )

  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Releases' })
    .click()
  await expect(page.getByTestId('publication-status-live')).toBeVisible({
    timeout: 15_000,
  })
})
