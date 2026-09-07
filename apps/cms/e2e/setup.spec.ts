import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'

const cmsRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function runCmsScript(script: string) {
  execSync(`pnpm ${script}`, {
    cwd: cmsRoot,
    stdio: 'inherit',
    env: process.env,
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  runCmsScript('db:reset')
})

test.afterAll(() => {
  runCmsScript('db:reset')
  runCmsScript('db:seed')
})

test('empty CMS redirects to /setup and creates the first admin', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 })
  await expect(page.locator('form[data-ready="true"]')).toBeVisible()

  await page.getByLabel('Name').fill('Agency Admin')
  await page.getByLabel('Email').fill('admin@areca.local')
  await page.getByLabel('Password').fill('password123')
  await page
    .locator('form[data-ready="true"]')
    .getByRole('button', { name: 'Create admin account' })
    .click()

  await expect(page).toHaveURL('/', { timeout: 15_000 })
  await expect(page.getByTestId('get-started')).toBeVisible()
})

test('a second visit to /setup redirects to /login', async ({ page }) => {
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
})
