import { expect, type Page } from '@playwright/test'

const password = 'password123'

export async function login(page: Page, email = 'admin@areca.local') {
  await page.goto('/login')
  await expect(page.locator('form[data-ready="true"]')).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/', { timeout: 15_000 })
}

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
