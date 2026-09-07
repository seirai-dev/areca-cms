import { expect, type Page } from '@playwright/test'

const password = 'password123'

export function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function datetimeLocalMinutesAgo(minutes: number) {
  const date = new Date(Date.now() - minutes * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export async function login(page: Page, email = 'admin@areca.local') {
  await page.goto('/login')
  await expect(page.locator('form[data-ready="true"]')).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/', { timeout: 15_000 })
}

export async function signOut(page: Page) {
  await expect(page.getByTestId('sign-out')).toBeEnabled()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
}

export async function openSite(page: Page, name: string | RegExp) {
  await page.getByTestId('sites-nav').getByRole('link', { name }).click()
  await expect(page.getByTestId('release-status')).toBeVisible()
}

export async function waitForSavedDraft(page: Page) {
  await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('entry-status')).not.toHaveAttribute(
    'data-status',
    'unsaved',
    { timeout: 15_000 },
  )
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  await expect(page).toHaveURL(/\/c\/[^/]+\/(?!new(?:\/|$))[^/]+$/, {
    timeout: 15_000,
  })
}

export async function fillArticleDraft(page: Page, title: string) {
  await page.getByLabel(/Title/).fill(title)
  await page.getByTestId('rich-text-editor').click()
  await page.keyboard.type(`Body for ${title}`)
}

export async function createAndSaveArticle(page: Page, title: string) {
  await page.getByTestId('collection-articles').getByRole('link', { name: 'Open' }).click()
  await page.getByTestId('new-entry').click()
  await fillArticleDraft(page, title)
  await page.getByTestId('save-draft').click()
  await waitForSavedDraft(page)
}

export async function createIsolatedAcmeSite(page: Page, suffix: string) {
  const siteName = `E2E Site ${suffix}`
  const siteSlug = `e2e-site-${suffix}`
  const productionUrl = `https://e2e-${suffix}.example.com`

  await login(page)
  await page.goto('/admin/organizations')
  await page.getByRole('link', { name: 'Acme', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Acme' })).toBeVisible()

  await page.getByTestId('new-site').click()
  await page.getByTestId('site-name').fill(siteName)
  await expect(page.getByTestId('site-slug')).toHaveValue(siteSlug)
  await page.getByTestId('site-production-url').fill(productionUrl)
  await page.getByRole('button', { name: 'Create site' }).click()

  const tokenAlert = page.getByTestId('site-token-alert')
  await expect(tokenAlert).toBeVisible({ timeout: 15_000 })
  const token = (await page.getByTestId('site-token-value').innerText()).trim()
  expect(token).toBeTruthy()

  await page
    .getByRole('row')
    .filter({ hasText: siteSlug })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\/settings/, { timeout: 15_000 })

  await page.getByTestId('add-collection').click()
  await page.getByTestId('collection-key').fill('articles')
  await page.getByTestId('collection-label').fill('Articles')
  await page.getByTestId('collection-route').fill('/blog/$slug')
  await page.getByTestId('field-key-0').fill('title')
  await page.getByTestId('field-label-0').fill('Title')
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-key-1').fill('slug')
  await page.getByTestId('field-label-1').fill('Slug')
  await page.getByTestId('field-type-1').click()
  await page.getByRole('option', { name: 'slug' }).click()
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-key-2').fill('body')
  await page.getByTestId('field-label-2').fill('Body')
  await page.getByTestId('field-type-2').click()
  await page.getByRole('option', { name: 'richtext' }).click()
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-key-3').fill('heroImage')
  await page.getByTestId('field-label-3').fill('Hero image')
  await page.getByTestId('field-type-3').click()
  await page.getByRole('option', { name: 'image' }).click()
  await page.getByTestId('save-collection').click()
  await expect(page.getByRole('cell', { name: 'articles', exact: true })).toBeVisible(
    { timeout: 15_000 },
  )

  await signOut(page)
  return { siteName, siteSlug, token, productionUrl }
}

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
