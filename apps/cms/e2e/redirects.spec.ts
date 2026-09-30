import { expect, test } from '@playwright/test'

import { ACME_SITE, OWNER, hydrated, login, openSite } from './helpers'

test('old admin URLs lead into the Agency workspace', async ({ page }) => {
  await login(page)
  const cases: Array<[string, RegExp]> = [
    ['/admin', /\/agency$/],
    ['/admin/organizations', /\/agency\/clients$/],
    ['/admin/users', /\/agency\/people$/],
    ['/admin/audit', /\/agency\/activity$/],
    ['/admin/branding', /\/agency\/branding$/],
  ]
  for (const [from, to] of cases) {
    await page.goto(from)
    await expect(page, `${from} redirects`).toHaveURL(to)
  }
  await expect(page.getByTestId('branding-page')).toBeVisible()

  // Organization detail and members pages map onto the client page.
  await page.goto('/agency/clients')
  await hydrated(page)
  await page.getByLabel('Search clients').fill('Acme')
  await page.getByTestId('client-row-acme').click()
  const orgId = page.url().match(/\/agency\/clients\/([^/?#]+)/)?.[1]
  expect(orgId).toBeTruthy()
  await page.goto(`/admin/organizations/${orgId}`)
  await expect(page).toHaveURL(new RegExp(`/agency/clients/${orgId}`))
  await page.goto(`/orgs/${orgId}/members`)
  await expect(page).toHaveURL(new RegExp(`/agency/clients/${orgId}\\?tab=people`))
  await expect(page.getByRole('tab', { name: 'People' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('old site URLs open the new places', async ({ page }) => {
  await login(page, OWNER)
  const siteId = await openSite(page, ACME_SITE)
  const cases: Array<[string, RegExp]> = [
    [`/sites/${siteId}/releases`, new RegExp(`/sites/${siteId}\\?panel=golive$`)],
    [`/sites/${siteId}/activity`, new RegExp(`/sites/${siteId}\\?panel=activity$`)],
    [`/sites/${siteId}/media`, new RegExp(`/sites/${siteId}/library$`)],
    [`/sites/${siteId}/team`, new RegExp(`/sites/${siteId}/people$`)],
  ]
  for (const [from, to] of cases) {
    await page.goto(from)
    await expect(page, `${from} redirects`).toHaveURL(to)
  }
  await expect(page.getByTestId('people-page')).toBeVisible()

  // The panels are real deep links.
  await page.goto(`/sites/${siteId}/releases`)
  await expect(page.getByTestId('golive-panel')).toBeVisible()
  await page.goto(`/sites/${siteId}/activity`)
  await expect(page.getByTestId('activity-panel')).toBeVisible()
})

test('unknown pages show the friendly 404', async ({ page }) => {
  await login(page, OWNER)
  await page.goto('/this/page/does-not-exist')
  await expect(page.getByTestId('not-found')).toBeVisible()
  await expect(page.getByText("This page doesn't exist")).toBeVisible()
  await page.getByTestId('not-found-home').click()
  await expect(page).not.toHaveURL(/does-not-exist/)
})
