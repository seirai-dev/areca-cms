import { expect, test, type Page } from '@playwright/test'

const password = 'password123'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await expect(page.locator('form[data-ready="true"]')).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/', { timeout: 15_000 })
}

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
