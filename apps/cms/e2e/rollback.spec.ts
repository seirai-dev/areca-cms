import { expect, test } from '@playwright/test'

import {
  OWNER,
  backToCollection,
  createArticle,
  createIsolatedAcmeSite,
  expectToast,
  goLiveFromTray,
  login,
  markAsReady,
  openCollection,
  openGoLivePanel,
  openSite,
  slugify,
  titleInput,
  uniqueSuffix,
  waitForSaved,
} from './helpers'

test('owner restores a replaced release from the Go-live panel', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const title = `E2E Rollback ${suffix}`
  const { siteSlug } = await createIsolatedAcmeSite(page, `rb-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')

  // First release.
  await createArticle(page, title)
  await markAsReady(page)
  await backToCollection(page)
  await goLiveFromTray(page)

  // Second release with an edit.
  await page
    .getByTestId(`entry-${slugify(title)}`)
    .getByRole('link')
    .first()
    .click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await titleInput(page).fill(`${title} v2`)
  await waitForSaved(page)
  // A live entry with newer draft edits is marked "Edited since ready" and
  // can be marked ready again.
  await expect(
    page.getByTestId('entry-status').getByTestId('edited-since-ready'),
  ).toBeVisible()
  await markAsReady(page)
  await backToCollection(page)
  await goLiveFromTray(page)

  const panel = await openGoLivePanel(page)
  const live = panel.getByTestId('publication-live')
  const replaced = panel.getByTestId('publication-superseded')
  await expect(live).toHaveCount(1)
  await expect(replaced).toHaveCount(1)
  await expect(replaced).toContainText('Replaced')
  // Only previously-live releases that are not live now can be restored.
  await expect(live.getByTestId('publication-menu')).toHaveCount(0)
  const restoredId = await replaced.getAttribute('data-release-id')
  const liveId = await live.getAttribute('data-release-id')

  await replaced.getByTestId('publication-menu').click()
  await page.getByTestId('rollback-publication').click()
  const confirm = page.getByRole('alertdialog')
  await expect(
    confirm.getByRole('heading', { name: 'Restore this version?' }),
  ).toBeVisible()
  await confirm.getByRole('button', { name: 'Restore this version' }).click()
  await expectToast(page, 'Restoring this version')

  // The restored release is live again; the other one is now replaced.
  await expect(
    panel.locator(`[data-release-id="${restoredId}"]`),
  ).toHaveAttribute('data-testid', 'publication-live', { timeout: 45_000 })
  await expect(
    panel.locator(`[data-release-id="${liveId}"]`),
  ).toHaveAttribute('data-testid', 'publication-superseded')
  await expect(panel.getByTestId('publication-live')).toHaveCount(1)
  await expect(
    panel.locator(`[data-release-id="${liveId}"]`).getByTestId('publication-menu'),
  ).toBeVisible()
  // Changes made ready since then stay ready for the next Go live.
  const tray = page.getByTestId('release-status')
  await expect(tray).toHaveAttribute('data-state', 'ready')
  await expect(tray).toContainText('1 change ready')
})
