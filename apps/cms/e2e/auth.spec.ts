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

test('sign out returns to /login', async ({ page }) => {
  await login(page, 'owner@acme.local')
  await expect(page.getByTestId('sign-out')).toBeEnabled()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
})
