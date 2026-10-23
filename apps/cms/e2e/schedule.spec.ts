import { expect, test } from '@playwright/test'

import {
  OWNER,
  backToCollection,
  createArticle,
  createIsolatedAcmeSite,
  expectToast,
  hydrated,
  login,
  openCollection,
  openGoLivePanel,
  openSite,
  slugify,
  uniqueSuffix,
} from './helpers'

/** `YYYY-MM-DDTHH:mm` in the local zone (the browser shares the host's). */
function localDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

test('owner schedules an article from the popover and the worker makes it live', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const suffix = uniqueSuffix()
  const title = `E2E Scheduled ${suffix}`
  const { siteSlug } = await createIsolatedAcmeSite(page, `sched-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await createArticle(page, title)

  // Mark as ready ▾ › Schedule… opens the popover.
  await page.getByTestId('publish-menu').click()
  await page.getByTestId('schedule-entry').click()
  const popover = page.getByTestId('schedule-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByText('Schedule going live')).toBeVisible()
  for (const preset of ['tomorrow', 'monday', 'hour']) {
    await expect(page.getByTestId(`schedule-preset-${preset}`)).toBeVisible()
  }
  await page.getByTestId('schedule-preset-hour').click()
  await expect(page.getByTestId('schedule-preset-hour')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // A time in the past is refused in place.
  await page
    .getByTestId('schedule-at')
    .fill(localDateTime(new Date(Date.now() - 5 * 60_000)))
  await page.getByTestId('schedule-confirm').click()
  await expect(popover.getByRole('alert')).toHaveText(
    'Pick a time in the future.',
  )

  // The next whole minute that is at least 30s away.
  const at = new Date(Date.now() + 90_000)
  at.setSeconds(0, 0)
  await page.getByTestId('schedule-at').fill(localDateTime(at))
  await page.getByTestId('schedule-confirm').click()
  await expectToast(page, 'Scheduled to go live')
  await expect(popover).toBeHidden()
  const status = page.getByTestId('entry-status')
  await expect(status).toHaveAttribute('data-status', 'scheduled')
  await expect(status).toHaveAttribute('data-ui-status', 'scheduled')
  await expect(page.getByTestId('status-cancel-schedule')).toBeVisible()

  // The collection's Scheduled filter lists it until the time comes.
  await backToCollection(page)
  await page.getByTestId('status-filter-scheduled').click()
  const row = page.getByTestId(`entry-${slugify(title)}`)
  await expect(row).toBeVisible()
  await expect(row.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'scheduled',
  )

  // The editor watches a scheduled entry; the worker publishes it when due
  // and requests a release.
  await row.getByRole('link').first().click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
    { timeout: 180_000 },
  )
  await backToCollection(page)
  // The list does not poll; a reload shows the new state.
  await page.reload()
  await hydrated(page, page.getByTestId('site-content'))
  await page.getByTestId('status-filter-all').click()
  await expect(page.getByTestId('release-status')).toHaveAttribute(
    'data-state',
    'up-to-date',
    { timeout: 60_000 },
  )
  const panel = await openGoLivePanel(page)
  await expect(panel.getByTestId('publication-live')).toHaveCount(1)
  await expect(row.getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'live',
  )
})
