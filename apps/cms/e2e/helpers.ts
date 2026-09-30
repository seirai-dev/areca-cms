import { expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'

export const PASSWORD = 'password123'
export const ADMIN = 'admin@areca.local'
export const OWNER = 'owner@acme.local'
export const EDITOR = 'editor@acme.local'
/** The seeded site (scripts/seed.ts). */
export const ACME_SITE = 'acme-site'

export const EDITOR_REASON =
  'Only owners can publish. Your changes are saved as a draft and an owner can make them live.'

export function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/* ------------------------------------------------------------------------
   Auth and shell
------------------------------------------------------------------------ */

/**
 * The auth card's form once hydrated (`data-ready="true"`). A fresh browser
 * context loads the whole dev module graph, which can take a while when
 * several workers start at once.
 */
export async function authForm(page: Page) {
  const form = page.locator('form[data-ready="true"]')
  await expect(form).toBeVisible({ timeout: 60_000 })
  return form
}

export async function login(page: Page, email = ADMIN) {
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await form.getByRole('button', { name: 'Sign in' }).click()
  // `/` resolves to a workspace (last site, only site, Agency or /sites).
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
}

/**
 * Opens a popover/sheet from its trigger once the shell has hydrated. Clicks
 * before hydration do nothing, and a second click would close it again, so
 * we only click while the trigger is not expanded.
 */
async function openFromTrigger(trigger: Locator, content: Locator) {
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click()
    }
    await expect(content).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** The account row (bottom of the sidebar) and its menu. */
export async function openAccountMenu(page: Page) {
  const menu = page.getByTestId('account-menu')
  await openFromTrigger(page.getByTestId('user-menu'), menu)
  return menu
}

export async function signOut(page: Page) {
  // The focus-mode editor has no sidebar; leave it first.
  if (await page.getByTestId('editor-back').isVisible()) {
    await page.getByTestId('editor-back').click()
  }
  await openAccountMenu(page)
  await expect(page.getByTestId('sign-out')).toBeEnabled()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
}

/** Workspace switcher (the card at the top of the sidebar). */
export async function openSwitcher(page: Page) {
  const list = page.locator('[cmdk-list]')
  await openFromTrigger(page.getByTestId('sites-nav'), list)
  return list
}

/**
 * Opens a site workspace by its slug: from the `/sites` picker when that is
 * where we are (several sites, no last site yet), otherwise through the
 * sidebar's workspace switcher.
 */
export async function openSite(page: Page, slug: string) {
  if (/\/sites\/?(?:[?#].*)?$/.test(new URL(page.url()).pathname)) {
    await expect(page.getByTestId('sites-page')).toBeVisible()
    // Every card is a link, so this also works before hydration.
    await page.getByTestId(`site-card-${slug}`).click()
  } else {
    await openSwitcher(page)
    const search = page.getByPlaceholder('Search sites…')
    if (await search.isVisible()) await search.fill(slug)
    await page.getByTestId(`switch-site-${slug}`).click()
  }
  await expect(page).toHaveURL(/\/sites\/[^/?]+(?:\?.*)?$/)
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await expect(page.getByTestId('release-status')).toBeVisible()
  return siteIdFromUrl(page)
}

export function siteIdFromUrl(page: Page) {
  const id = page.url().match(/\/sites\/([^/?#]+)/)?.[1]
  expect(id, 'site id in the URL').toBeTruthy()
  return id!
}

/** Opens the Agency workspace (admins) through the switcher. */
export async function openAgency(page: Page) {
  await openSwitcher(page)
  await page.getByTestId('agency-nav').click()
  await expect(page).toHaveURL(/\/agency$/)
  await expect(page.getByTestId('agency-overview')).toBeVisible()
}

/** A collection from the sidebar's CONTENT group. */
export async function openCollection(page: Page, key = 'articles') {
  await page.getByTestId('sidebar').getByTestId(`collection-${key}`).click()
  await expect(page).toHaveURL(new RegExp(`/c/${key}(?:\\?.*)?$`))
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )
}

/** The Go‑live panel, opened from the sidebar tray. */
export async function openGoLivePanel(page: Page) {
  const panel = page.getByTestId('golive-panel')
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await page
        .getByTestId('release-status')
        .getByRole('button', { name: 'Open Go live' })
        .first()
        .click()
    }
    await expect(panel).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  await expect(page).toHaveURL(/[?&]panel=golive/)
  return panel
}

export async function closePanel(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/[?&]panel=/)
}

/**
 * "Visible but disabled, with the reason" (brief §1.3): the control is
 * disabled and hovering its wrapper shows the reason as a tooltip.
 */
export async function expectDisabledWithReason(
  page: Page,
  control: Locator,
  reason: string | RegExp = EDITOR_REASON,
) {
  await expect(control).toBeVisible()
  await expect(control).toBeDisabled()
  const wrap = control.locator('xpath=ancestor::*[@data-slot="hint-wrap"][1]')
  const tooltip = page.getByRole('tooltip').filter({ hasText: reason })
  await expect(async () => {
    await page.mouse.move(0, 0)
    await wrap.first().hover()
    await expect(tooltip.first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** Waits for a toast with this text. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: text }).first(),
  ).toBeVisible()
}

/* ------------------------------------------------------------------------
   Agency: clients and sites
------------------------------------------------------------------------ */

/** Opens a client page from Agency › Clients (search by name). */
export async function openClient(page: Page, name: string, slug: string) {
  await page.goto('/agency/clients')
  await expect(page.getByTestId('organizations-page')).toBeVisible()
  await page.getByLabel('Search clients').fill(name)
  await page.getByTestId(`client-row-${slug}`).click()
  await expect(page.getByTestId('organization-page')).toBeVisible()
  await expect(page.getByTestId('client-slug')).toHaveText(slug)
}

export type CreatedSite = {
  siteName: string
  siteSlug: string
  productionUrl: string
  token: string
}

/**
 * On a client page: New site → step 1 (name, auto slug, URL) → step 2 (the
 * one-time token reveal) → "I've saved it".
 */
export async function createSiteOnClientPage(
  page: Page,
  suffix: string,
  prefix = 'E2E Site',
): Promise<CreatedSite> {
  const siteName = `${prefix} ${suffix}`
  const siteSlug = slugify(siteName)
  const productionUrl = `https://${siteSlug}.example.com`

  await page.getByTestId('client-tab-sites').click()
  await page.getByTestId('new-site').first().click()
  const sheet = page.getByTestId('new-site-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Step 1 of 2')).toBeVisible()
  await page.getByTestId('site-name').fill(siteName)
  await expect(page.getByTestId('site-slug')).toHaveValue(siteSlug)
  await page.getByTestId('site-production-url').fill(productionUrl)
  await page.getByTestId('create-site').click()

  await expect(sheet.getByText('Step 2 of 2')).toBeVisible()
  const alert = page.getByTestId('site-token-alert')
  await expect(alert).toBeVisible()
  await expect(page.getByTestId('site-token-env')).toContainText(
    'ARECA_SITE_TOKEN=',
  )
  const token = (await page.getByTestId('site-token-value').innerText()).trim()
  expect(token).toMatch(/^[a-f0-9]{32,}$/)
  await page.getByTestId('token-saved').click()
  await expect(sheet).toBeHidden()
  return { siteName, siteSlug, productionUrl, token }
}

export const ARTICLES_MANIFEST = {
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'heroImage', label: 'Hero image', type: 'image' },
      ],
    },
  },
}

/**
 * Pushes a manifest with the site token, as `areca manifest push` does. Use
 * a cookie-less request context (the `request` fixture, or omit it): the
 * CMS rejects cookie-bearing POSTs without an Origin (CSRF guard).
 */
export async function pushManifest(
  request: APIRequestContext | string,
  token: string,
  manifest: object = ARTICLES_MANIFEST,
) {
  const context =
    typeof request === 'string'
      ? await playwrightRequest.newContext({ baseURL: request })
      : request
  const response = await context.post('/api/sites/manifest', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: manifest,
  })
  expect(response.status(), await response.text()).toBe(200)
  if (typeof request === 'string') await context.dispose()
}

/**
 * A fresh Acme site with an Articles collection (via the site token), so a
 * spec owns its release history. Signs the admin out again.
 */
export async function createIsolatedAcmeSite(
  page: Page,
  suffix: string,
): Promise<CreatedSite> {
  await login(page, ADMIN)
  await openClient(page, 'Acme', 'acme')
  const site = await createSiteOnClientPage(page, suffix)
  await pushManifest(new URL(page.url()).origin, site.token)
  await signOut(page)
  return site
}

/* ------------------------------------------------------------------------
   Editor
------------------------------------------------------------------------ */

export function titleInput(page: Page) {
  return page.getByRole('textbox', { name: 'Title', exact: true })
}

/** The top bar's save indicator (a compact twin exists for small screens). */
export function saveStatus(page: Page) {
  return page.getByTestId('save-status').filter({ visible: true })
}

export function richText(page: Page) {
  return page.getByTestId('rich-text-editor')
}

/** From a collection: the primary "New …" button opens the focus editor. */
export async function startNewEntry(page: Page) {
  await page.getByTestId('new-entry').click()
  await expect(page).toHaveURL(/\/c\/[^/]+\/new$/)
  // `data-ready` flips once an existing entry is loaded; a new one has none.
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await expect(titleInput(page)).toBeEditable()
  await expect(saveStatus(page)).toHaveText(/Not saved yet/)
}

/** Title + body. Autosave creates the entry once the slug is valid. */
export async function writeArticle(page: Page, title: string, body = `Body for ${title}`) {
  await titleInput(page).fill(title)
  await richText(page).click()
  await page.keyboard.type(body)
}

/** Autosave settled: the entry exists (URL has its id) and nothing is dirty. */
export async function waitForSaved(page: Page) {
  await expect(page).toHaveURL(/\/c\/[^/]+\/(?!new(?:[/?#]|$))[^/?#]+(?:\?.*)?$/, {
    timeout: 20_000,
  })
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-dirty',
    'false',
    { timeout: 20_000 },
  )
  await expect(saveStatus(page)).not.toHaveAttribute(
    'data-state',
    /saving|failed|blocked/,
  )
  await expect(saveStatus(page)).toHaveText(/Saved/)
}

export function entryIdFromUrl(page: Page) {
  const id = page.url().match(/\/c\/[^/]+\/([^/?#]+)/)?.[1]
  expect(id && id !== 'new', 'entry id in the URL').toBeTruthy()
  return id!
}

/** New article in the current collection, autosaved. Returns its id. */
export async function createArticle(page: Page, title: string) {
  await startNewEntry(page)
  await writeArticle(page, title)
  await waitForSaved(page)
  return entryIdFromUrl(page)
}

/** The primary split button: "Mark as ready". */
export async function markAsReady(page: Page) {
  const primary = page.getByTestId('publish-now')
  await expect(primary).toHaveText(/Mark as ready/)
  await primary.click()
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'ready',
  )
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
  )
  await expect(primary).toHaveText('Ready')
  await expect(primary).toBeDisabled()
}

/** Leaves the focus editor for the collection it belongs to. */
export async function backToCollection(page: Page) {
  await page.getByTestId('editor-back').click()
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )
}

/** Tray → Go live (sidebar); waits until the site is up to date. */
export async function goLiveFromTray(page: Page) {
  const tray = page.getByTestId('release-status')
  await expect(tray).toHaveAttribute('data-state', /ready|never-live/)
  await tray.getByTestId('publish-site').click()
  await expect(tray).toHaveAttribute('data-state', 'up-to-date', {
    timeout: 45_000,
  })
}

/** Rows of the Go‑live panel's releases timeline. */
export function releases(panel: Locator) {
  return panel.getByTestId('publications')
}
