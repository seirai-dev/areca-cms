import { expect, test } from '@playwright/test'

import { login } from './helpers'

test('unauthenticated / redirects to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('owner login shows Acme site in the sidebar', async ({ page }) => {
  await login(page, 'owner@acme.local')
  await expect(
    page.getByTestId('sites-nav').getByRole('link', { name: /acme-site/i }),
  ).toBeVisible()
})

test('agency admin sees the Agency section', async ({ page }) => {
  await login(page, 'admin@areca.local')
  await expect(page.getByTestId('agency-nav')).toBeVisible()
  await expect(page.getByTestId('agency-nav').getByText('Agency')).toBeVisible()
})

test('editor does not see the Agency section', async ({ page }) => {
  await login(page, 'editor@acme.local')
  await expect(page.getByTestId('agency-nav')).toHaveCount(0)
})

test('owner sees Team on a site; editor does not', async ({ page }) => {
  await login(page, 'owner@acme.local')
  await page
    .getByTestId('sites-nav')
    .getByRole('link', { name: /acme-site/i })
    .click()
  await expect(page.getByTestId('team-nav')).toBeVisible()
  await expect(page.getByTestId('team-nav')).toHaveAttribute(
    'href',
    /\/orgs\/[^/]+\/members/,
  )

  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })

  await login(page, 'editor@acme.local')
  await page
    .getByTestId('sites-nav')
    .getByRole('link', { name: /acme-site/i })
    .click()
  await expect(page.getByTestId('release-status')).toBeVisible()
  await expect(page.getByTestId('team-nav')).toHaveCount(0)
  await expect(page.getByTestId('publish-site')).toHaveCount(0)

  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByTestId('new-entry').click()
  await expect(page.getByTestId('entry-editor')).toBeVisible()
  await expect(page.getByTestId('publish-menu')).toHaveCount(0)
})

test('sign out returns to /login', async ({ page }) => {
  await login(page, 'owner@acme.local')
  await expect(page.getByTestId('sign-out')).toBeEnabled()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
})
