import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

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
  await page
    .locator('form[data-ready="true"]')
    .getByRole('button', { name: 'Sign in' })
    .click()
  // `/` resolves to a workspace (last site, only site, Agency or /sites).
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
}

export async function signOut(page: Page) {
  // The menu only opens once the shell has hydrated, so keep trying.
  await expect(async () => {
    await page.getByTestId('user-menu').click()
    await expect(page.getByTestId('sign-out')).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await expect(page.getByTestId('sign-out')).toBeEnabled()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
}

export async function openSite(page: Page, name: string | RegExp) {
  await page.getByTestId('sites-nav').click()
  await page.getByRole('link', { name }).click()
  await expect(page.getByTestId('release-status')).toBeVisible()
}

export async function waitForSavedDraft(page: Page) {
  await expect(page.getByText('Draft saved').first()).toBeVisible({
    timeout: 15_000,
  })
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
  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
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
  await expect(page.getByTestId('organization-page')).toBeVisible()
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

  // Acme collects many e2e sites, so narrow the table down to this one.
  await page.getByTestId('org-sites-search').fill(siteSlug)
  await page
    .getByRole('row')
    .filter({ hasText: siteSlug })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page).toHaveURL(/\/sites\/[^/]+\/settings/, { timeout: 15_000 })
  await expect(page.getByTestId('settings-site-slug')).toHaveValue(siteSlug)

  // Collections are managed on the site's Content tab.
  await page
    .getByTestId('site-nav')
    .getByRole('link', { name: 'Content' })
    .click()
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 15_000 },
  )
  // The collection drawer opens on Settings in create mode, then Fields.
  await page.getByTestId('add-collection').click()
  await page.getByTestId('collection-key').fill('articles')
  await page.getByTestId('collection-label').fill('Articles')
  await page.getByTestId('collection-route').fill('/blog/$slug')
  await page.getByRole('tab', { name: 'Fields' }).click()
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-text').click()
  await page.getByTestId('field-key-1').fill('title')
  await page.getByTestId('field-label-1').fill('Title')
  await page.getByTestId('field-required-1').click()
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-richtext').click()
  await page.getByTestId('field-key-2').fill('body')
  await page.getByTestId('field-label-2').fill('Body')
  await page.getByTestId('field-required-2').click()
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-image').click()
  await page.getByTestId('field-key-3').fill('heroImage')
  await page.getByTestId('field-label-3').fill('Hero image')
  await page.getByTestId('save-collection').click()
  await expect(page.getByTestId('collection-articles')).toBeVisible({
    timeout: 15_000,
  })

  await signOut(page)
  return { siteName, siteSlug, token, productionUrl }
}

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
