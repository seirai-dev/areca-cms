import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  E2E_CLOUDFLARE_ACCOUNT_ID,
  E2E_CLOUDFLARE_TOKENS,
  E2E_SHOP_PROD_TRIGGER,
  E2E_WORKERS_SUBDOMAIN,
} from './cloudflare-stub'
import {
  createAgencyClient,
  createSiteOnClientPage,
  expectToast,
  hydrated,
  login,
  uniqueSuffix,
} from './helpers'

/*
 * A site's Deployment tab with Cloudflare as the provider, against the
 * Cloudflare stub (see cloudflare-stub.ts for the Pages projects and Workers).
 * The seeded admin has no two-factor, so saves skip step-up here.
 */

const MARKETING_HEALTH = 'https://marketing.example.com/api/health'
const SHOP_HEALTH = `https://shop-worker.${E2E_WORKERS_SUBDOMAIN}.workers.dev/api/health`

async function connectCloudflare(page: Page) {
  await page.getByTestId('client-tab-deployment').click()
  await expect(page.getByTestId('cloudflare-card')).toBeVisible()
  await hydrated(page, page.getByTestId('cloudflare-card'))
  await page
    .getByTestId('cloudflare-account-id')
    .fill(E2E_CLOUDFLARE_ACCOUNT_ID)
  await page
    .getByTestId('cloudflare-api-token')
    .fill(E2E_CLOUDFLARE_TOKENS.full)
  await page.getByTestId('cloudflare-save').click()
  await expectToast(page, 'Cloudflare credentials saved and checked')
  await expect(page.getByTestId('cloudflare-status')).toContainText('Connected')
}

async function openSiteDeployment(page: Page, siteSlug: string) {
  await page
    .getByTestId(`client-site-${siteSlug}`)
    .getByTestId(`site-settings-${siteSlug}`)
    .click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\/settings/)
  await page.getByRole('tab', { name: 'Deployment' }).click()
  await expect(page.getByTestId('settings-deployment')).toBeVisible()
  await expect(page.getByTestId('deployment-provider')).toBeVisible()
}

test.describe('Cloudflare deployment target', () => {
  test('a site picks a Pages project, then a Worker, and the choice persists', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const suffix = uniqueSuffix()
    await login(page)
    await createAgencyClient(page, `E2E Cloudflare target ${suffix}`)
    const clientPath = new URL(page.url()).pathname
    await connectCloudflare(page)
    const site = await createSiteOnClientPage(page, suffix)
    await openSiteDeployment(page, site.siteSlug)

    // Cloudflare is available now that the client is connected.
    const cloudflare = page.getByTestId('deployment-provider-cloudflare')
    await expect(cloudflare).toBeEnabled()
    await cloudflare.click()
    await expect(cloudflare).toHaveAttribute('data-state', 'on')
    await expect(
      page.getByTestId('deployment-provider-dokploy'),
    ).toHaveAttribute('data-state', 'off')

    // One picker, two groups. Unbuildable rows are disabled and say why.
    await page.getByTestId('target-combobox').click()
    await expect(page.getByTestId('target-combobox-search')).toBeVisible()
    const legacy = page.getByTestId('target-option-pages-legacy-upload')
    await expect(legacy).toHaveAttribute('aria-disabled', 'true')
    await expect(legacy).toContainText('No git connection')
    await expect(
      page.getByTestId('target-option-workers-plain-worker'),
    ).toContainText('Workers Builds not connected')
    const previewOnly = page.getByTestId(
      'target-option-workers-preview-only-worker',
    )
    await expect(previewOnly).toHaveAttribute('aria-disabled', 'true')
    await expect(previewOnly).toContainText('No production build trigger')

    // Search matches the name, the domain and the branch.
    const search = page.getByTestId('target-combobox-search')
    await search.fill('market')
    await expect(
      page.getByTestId('target-option-pages-marketing-site'),
    ).toBeVisible()
    await expect(
      page.getByTestId('target-option-pages-northbound-site'),
    ).toHaveCount(0)
    await expect(
      page.getByTestId('target-option-workers-shop-worker'),
    ).toHaveCount(0)
    await search.fill('example.com')
    await expect(
      page.getByTestId('target-option-pages-marketing-site'),
    ).toBeVisible()
    await search.fill('')
    await page.getByTestId('target-option-pages-marketing-site').click()

    // The branch is read-only, and the health URL follows the custom domain.
    await expect(page.getByTestId('cloudflare-target-branch')).toContainText(
      'Builds branch',
    )
    await expect(page.getByTestId('cloudflare-target-branch')).toContainText(
      'main',
    )
    await expect(page.getByTestId('health-check-url')).toHaveValue(
      MARKETING_HEALTH,
    )
    await expect(page.getByTestId('cloudflare-trigger-select')).toHaveCount(0)

    await page.getByTestId('save-deployment-target').click()
    await expectToast(page, 'Deployment target updated')
    await expect(page.getByTestId('deployment-state')).toContainText(
      'marketing-site',
    )

    // Reload: the same provider, project and health URL come back.
    await page.reload()
    await page.getByRole('tab', { name: 'Deployment' }).click()
    await expect(page.getByTestId('settings-deployment')).toBeVisible()
    await expect(
      page.getByTestId('deployment-provider-cloudflare'),
    ).toHaveAttribute('data-state', 'on')
    await expect(page.getByTestId('deployment-state')).toContainText(
      'marketing-site',
    )
    await expect(page.getByTestId('health-check-url')).toHaveValue(
      MARKETING_HEALTH,
    )

    // A Worker with a production and a preview trigger: the production one is
    // picked, the select offers both, and the health URL follows the Worker.
    await page.getByTestId('target-combobox').click()
    await page.getByTestId('target-combobox-search').fill('shop')
    await page.getByTestId('target-option-workers-shop-worker').click()
    const triggerSelect = page.getByTestId('cloudflare-trigger-select')
    await expect(triggerSelect).toBeVisible()
    await expect(triggerSelect).toHaveValue(E2E_SHOP_PROD_TRIGGER)
    await expect(page.getByTestId('cloudflare-target-branch')).toContainText(
      'main',
    )
    await expect(page.getByTestId('health-check-url')).toHaveValue(SHOP_HEALTH)
    await page.getByTestId('save-deployment-target').click()
    await expectToast(page, 'Deployment target updated')
    await expect(page.getByTestId('deployment-state')).toContainText(
      'Cloudflare Worker shop-worker',
    )

    // Switching to Dokploy clears the chosen target and the health URL.
    await page.getByTestId('deployment-provider-dokploy').click()
    await expect(
      page.getByTestId('deployment-provider-dokploy'),
    ).toHaveAttribute('data-state', 'on')
    await expect(page.getByTestId('application-id')).toHaveValue('')
    await expect(page.getByTestId('health-check-url')).toHaveValue('')
    await expect(page.getByTestId('cloudflare-target-branch')).toHaveCount(0)
    await expect(page.getByTestId('settings-save-bar')).toBeVisible()

    // Discard brings the saved Worker back.
    await page
      .getByTestId('settings-save-bar')
      .getByRole('button', { name: 'Discard', exact: true })
      .click()
    await expect(
      page.getByTestId('deployment-provider-cloudflare'),
    ).toHaveAttribute('data-state', 'on')
    await expect(page.getByTestId('health-check-url')).toHaveValue(SHOP_HEALTH)
    await expect(page.getByTestId('settings-save-bar')).toBeHidden()

    // The client's remove dialog counts the site that deploys with Cloudflare.
    await page.goto(`${clientPath}?tab=deployment`)
    await hydrated(page, page.getByTestId('cloudflare-card'))
    await page.getByTestId('cloudflare-remove').click()
    const dialog = page.getByTestId('cloudflare-remove-confirm')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('cloudflare-remove-sites')).toContainText(
      'Sites deploying with Cloudflare: 1.',
    )
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
  })

  test('the picker stays usable at 320px', async ({ page }) => {
    test.setTimeout(180_000)
    const suffix = uniqueSuffix()
    await page.setViewportSize({ width: 320, height: 760 })
    await login(page)
    await createAgencyClient(page, `E2E Cloudflare narrow ${suffix}`)
    await connectCloudflare(page)
    const site = await createSiteOnClientPage(page, suffix)
    await openSiteDeployment(page, site.siteSlug)

    await page.getByTestId('deployment-provider-cloudflare').click()
    await page.getByTestId('target-combobox').click()
    await expect(page.getByTestId('target-combobox-search')).toBeVisible()
    await expect(
      page.getByTestId('target-option-pages-legacy-upload'),
    ).toBeVisible()

    // Nothing in the picker or the provider switch runs past the 320px edge.
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth
      const testIds = [
        'deployment-provider',
        'target-combobox',
        'target-combobox-search',
        'target-option-pages-marketing-site',
        'target-option-pages-legacy-upload',
      ]
      return testIds.flatMap((id) => {
        const element = document.querySelector(`[data-testid="${id}"]`)
        if (!element) return [id]
        const box = element.getBoundingClientRect()
        return box.right > width + 1 || box.left < -1 ? [id] : []
      })
    })
    expect(overflow).toEqual([])
  })

  test('with no Cloudflare connection the provider is disabled and links to the client', async ({
    page,
  }) => {
    const suffix = uniqueSuffix()
    await login(page)
    await createAgencyClient(page, `E2E Cloudflare unconnected ${suffix}`)
    const site = await createSiteOnClientPage(page, suffix)
    await openSiteDeployment(page, site.siteSlug)

    await expect(
      page.getByTestId('deployment-provider-cloudflare'),
    ).toBeDisabled()
    await expect(page.getByTestId('deployment-provider-dokploy')).toBeEnabled()
    const link = page.getByTestId('deployment-cloudflare-setup-link')
    await expect(link).toContainText('Set up Cloudflare for')
    await link.click()
    await expect(page).toHaveURL(/\/agency\/clients\/[^/?]+\?tab=deployment/)
    await expect(page.getByTestId('cloudflare-card')).toBeVisible()
  })
})
