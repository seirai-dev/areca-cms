import { expect, test } from '@playwright/test'

import {
  createSiteOnClientPage,
  login,
  openClient,
  pushManifest,
  uniqueSuffix,
} from './helpers'

test('the site token syncs a manifest (it shows up as content types) and reads snapshots', async ({
  page,
  request,
}) => {
  const suffix = uniqueSuffix()

  await login(page)
  await openClient(page, 'Acme', 'acme')
  const site = await createSiteOnClientPage(page, suffix, 'E2E API Site')

  await pushManifest(request, site.schemaToken, {
    collections: {
      pages: {
        route: '/pages/$slug',
        label: 'Pages',
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'slug', label: 'Slug', type: 'slug', required: true },
        ],
      },
    },
  })

  const manifest = await request.get('/api/sites/manifest', {
    headers: { Authorization: `Bearer ${site.token}` },
  })
  expect(manifest.status()).toBe(200)
  const body = (await manifest.json()) as {
    collections: Record<string, { route: string } | undefined>
  }
  expect(body.collections.pages?.route).toBe('/pages/$slug')

  // Settings › Developer shows the last synced manifest; Content lists it.
  await page
    .getByTestId(`client-site-${site.siteSlug}`)
    .getByTestId(`site-settings-${site.siteSlug}`)
    .click()
  await expect(page.getByTestId('site-settings')).toBeVisible()
  await page.getByRole('tab', { name: 'Developer' }).click()
  await expect(page.getByTestId('manifest-status')).toContainText('Pages')
  await page.getByRole('tab', { name: 'Content' }).click()
  await expect(page.getByTestId('content-type-pages')).toBeVisible()
  await expect(page.getByTestId('content-type-pages')).toContainText(
    '/pages/$slug',
  )
  await expect(
    page.getByTestId('sidebar').getByTestId('collection-pages'),
  ).toBeVisible()

  // Nothing is live yet.
  const empty = await request.get('/api/sites/snapshot/current', {
    headers: { Authorization: `Bearer ${site.token}` },
  })
  expect(empty.status()).toBe(404)
  expect(((await empty.json()) as { error?: string }).error).toBeTruthy()

  const denied = await request.get('/api/sites/snapshot/current', {
    headers: { Authorization: 'Bearer not-a-real-site-token' },
  })
  expect(denied.status()).toBe(401)
})
