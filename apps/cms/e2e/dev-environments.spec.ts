import { Pool } from 'pg'
import { expect, test } from '@playwright/test'

import {
  ADMIN,
  createIsolatedAcmeSite,
  expectToast,
  login,
  openSite,
  openSwitcher,
  siteIdFromUrl,
  uniqueSuffix,
} from './helpers'

/**
 * Puts a site in Production mode by a direct update. Going live for real
 * needs a deployment target, which the e2e stack does not have; the dev env
 * only checks the mode (docs/design/dev-environments.md, Decision 5).
 */
async function setProductionMode(slug: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const result = await pool.query(
      `update site set publishing_mode = 'production' where slug = $1`,
      [slug],
    )
    expect(result.rowCount).toBe(1)
  } finally {
    await pool.end()
  }
}

test('agency admin creates a development environment, works in it and deletes it', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const suffix = uniqueSuffix()
  const { siteName, siteSlug } = await createIsolatedAcmeSite(
    page,
    `dev-${suffix}`,
  )
  await setProductionMode(siteSlug)
  const devSlug = `${siteSlug}-dev`

  await login(page, ADMIN)
  const productionId = await openSite(page, siteSlug)

  // Settings › Development on the production site: create, then the tokens
  // are shown once.
  await page.goto(`/sites/${productionId}/settings?tab=development`)
  await expect(page.getByTestId('settings-tab-development')).toBeVisible()
  await page.getByTestId('dev-env-create').click()
  await expect(page.getByTestId('dev-env-created')).toBeVisible()
  await expect(page.getByTestId('dev-env-preview-secret')).toHaveText(
    /^[a-f0-9]{32,}$/,
  )
  await expect(page.getByTestId('site-token-alert')).toHaveCount(2)
  await page.getByTestId('dev-env-tokens-done').click()
  await expect(page.getByTestId('dev-env-created')).toBeHidden()
  await expect(page.getByTestId('dev-env-open')).toBeVisible()
  await expect(page.getByTestId('dev-env-delete')).toBeVisible()

  // The switcher nests the dev env under its production site, tagged Dev.
  await openSwitcher(page)
  const devRow = page.getByTestId(`switch-site-${devSlug}`)
  await expect(devRow).toBeVisible()
  await expect(devRow).toContainText('Dev')

  // Open it: the banner says where it is, and there is no Go live control.
  await devRow.click()
  await expect(page).toHaveURL(/\/sites\/[^/?]+(?:\?.*)?$/)
  const devId = siteIdFromUrl(page)
  expect(devId).not.toBe(productionId)
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await expect(page.getByTestId('dev-env-banner')).toContainText(
    `Development environment for ${siteName}`,
  )
  await expect(page.getByTestId('release-status')).toHaveCount(0)
  await expect(page.getByTestId('publish-site')).toHaveCount(0)
  await expect(page.getByTestId('overview-go-live')).toHaveCount(0)

  // A development environment has no Deployment tab.
  await page.goto(`/sites/${devId}/settings`)
  await expect(page.getByTestId('settings-general')).toBeVisible()
  await expect(page.getByTestId('settings-tab-deployment')).toHaveCount(0)
  await expect(page.getByTestId('settings-tab-development')).toHaveCount(0)

  // Back on the production site: reset from production.
  await page.goto(`/sites/${productionId}/settings?tab=development`)
  await page.getByTestId('dev-env-reset').click()
  await page.getByTestId('confirm-action').click()
  await expectToast(page, 'Development environment reset from production.')
  await expect(page.getByTestId('dev-env-open')).toBeVisible()

  // Then delete it. The production site keeps its Development tab, and
  // Create comes back.
  await page.getByTestId('dev-env-delete').click()
  await page.getByTestId('confirm-action').click()
  await expectToast(page, 'Development environment deleted.')
  await expect(page.getByTestId('dev-env-create')).toBeVisible()
})
