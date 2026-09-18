import { expect, test } from '@playwright/test'

import { login, uniqueSuffix } from './helpers'

test('site token can sync a manifest and read an empty snapshot', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const ts = uniqueSuffix()
  const orgName = `E2E API Org ${ts}`
  const orgSlug = `e2e-api-org-${ts}`
  const siteName = `E2E API Site ${ts}`
  const siteSlug = `e2e-api-site-${ts}`
  const productionUrl = `https://e2e-api-${ts}.example.com`

  await login(page)
  await page.goto('/admin/organizations')
  await expect(
    page.getByRole('heading', { name: 'Organizations' }),
  ).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()

  await page.getByTestId('new-organization').click()
  await expect(page.getByTestId('org-name')).toBeVisible()
  await page.getByTestId('org-name').fill(orgName)
  await expect(page.getByTestId('org-slug')).toHaveValue(orgSlug)
  await page.getByRole('button', { name: 'Create organization' }).click()
  await expect(page).toHaveURL(/\/admin\/organizations\/[^/]+$/, {
    timeout: 15_000,
  })

  await page.getByRole('tab', { name: 'Sites' }).click()
  await page.getByTestId('new-site').click()
  await page.getByTestId('site-name').fill(siteName)
  await expect(page.getByTestId('site-slug')).toHaveValue(siteSlug)
  await page.getByTestId('site-production-url').fill(productionUrl)
  await page.getByRole('button', { name: 'Create site' }).click()

  const tokenAlert = page.getByTestId('site-token-alert')
  await expect(tokenAlert).toBeVisible({ timeout: 15_000 })
  const token = (await page.getByTestId('site-token-value').innerText()).trim()
  expect(token).toBeTruthy()

  const synced = await request.post('/api/sites/manifest', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: {
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
    },
  })
  expect(synced.status()).toBe(200)

  await page
    .getByRole('row')
    .filter({ hasText: siteSlug })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\/settings/, { timeout: 15_000 })
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Content' })
    .click()
  await expect(page.getByTestId('collection-pages')).toBeVisible({
    timeout: 15_000,
  })

  const empty = await request.get('/api/sites/snapshot/current', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(empty.status()).toBe(404)
  const emptyBody = (await empty.json()) as { error?: string }
  expect(emptyBody.error).toBeTruthy()

  const denied = await request.get('/api/sites/snapshot/current', {
    headers: { Authorization: 'Bearer not-a-real-site-token' },
  })
  expect(denied.status()).toBe(401)
})
