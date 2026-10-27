import { createHmac } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'

import { expect, request as playwrightRequest } from '@playwright/test'
import type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
} from '@playwright/test'

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

/**
 * The RFC 6238 code (SHA-1, 6 digits, 30 s) for a base32 TOTP secret, as the
 * two-factor setup screen shows it.
 */
export function totpCode(base32Secret: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const key: number[] = []
  let bits = 0
  let value = 0
  for (const char of base32Secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) {
      key.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const digest = createHmac('sha1', Buffer.from(key)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0xf
  const binary = digest.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 1_000_000).padStart(6, '0')
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
   Hydration
------------------------------------------------------------------------ */

/**
 * Waits until React has hydrated `target` (it attaches its internal props to
 * the DOM node). Server-rendered markup is visible several seconds before
 * that on the dev server, and events fired earlier (clicks on buttons, file
 * inputs) are lost. Call after `goto`/`reload` before interacting.
 */
export async function hydrated(page: Page, target?: Locator) {
  const node = target ?? page.locator('#main-content')
  await expect
    .poll(
      () =>
        node
          .first()
          .evaluate((el) =>
            Object.keys(el).some((key) => key.startsWith('__reactProps')),
          )
          .catch(() => false),
      { timeout: 60_000, message: 'page hydrated' },
    )
    .toBe(true)
}

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

export async function login(page: Page, email = ADMIN, password = PASSWORD) {
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
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
  // The sidebar card on desktop, the mobile top bar's button on a phone.
  const trigger = page.locator(
    '[data-testid="sites-nav"]:visible, [data-testid="sites-nav-mobile"]:visible',
  )
  await openFromTrigger(trigger, list)
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
  // The sidebar (and its tray) is hidden on phones but still hydrates.
  await hydrated(page, page.getByTestId('sidebar'))
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
  await hydrated(page, page.getByTestId('sidebar'))
}

/** A collection from the sidebar's CONTENT group. */
export async function openCollection(page: Page, key = 'articles') {
  await page.getByTestId('sidebar').getByTestId(`collection-${key}`).click()
  await expect(page).toHaveURL(new RegExp(`/c/${key}(?:\\?.*)?$`))
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await hydrated(page, page.getByTestId('site-content'))
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
  await hydrated(page)
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
  schemaToken: string
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
  const buildReveal = sheet
    .getByTestId('site-token-alert')
    .filter({ hasText: 'ARECA_SITE_TOKEN=' })
  const schemaReveal = sheet
    .getByTestId('site-token-alert')
    .filter({ hasText: 'ARECA_SCHEMA_TOKEN=' })
  await expect(buildReveal).toBeVisible()
  await expect(schemaReveal).toBeVisible()
  const token = (
    await buildReveal.getByTestId('site-token-value').innerText()
  ).trim()
  const schemaToken = (
    await schemaReveal.getByTestId('site-token-value').innerText()
  ).trim()
  expect(token).toMatch(/^[a-f0-9]{32,}$/)
  expect(schemaToken).toMatch(/^[a-f0-9]{32,}$/)
  expect(schemaToken).not.toBe(token)
  await page.getByTestId('token-saved').click()
  await expect(sheet).toBeHidden()
  return { siteName, siteSlug, productionUrl, token, schemaToken }
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
  await pushManifest(new URL(page.url()).origin, site.schemaToken)
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
  await hydrated(page, titleInput(page))
  await expect(saveStatus(page)).toHaveText(/Not saved yet/)
}

/** Title + body. Autosave creates the entry once the slug is valid. */
export async function writeArticle(
  page: Page,
  title: string,
  body = `Body for ${title}`,
) {
  await titleInput(page).fill(title)
  await richText(page).click()
  await page.keyboard.type(body)
}

/** Autosave settled: the entry exists (URL has its id) and nothing is dirty. */
export async function waitForSaved(page: Page) {
  await expect(page).toHaveURL(
    /\/c\/[^/]+\/(?!new(?:[/?#]|$))[^/?#]+(?:\?.*)?$/,
    {
      timeout: 20_000,
    },
  )
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
  await hydrated(page, page.getByTestId('site-content'))
}

/**
 * Tray → Go live (sidebar); waits until the site is up to date. Clicks again
 * only while the tray still offers Go live (a click lost to a re-render, or
 * a rate-limited request: parallel workers share the seeded owner).
 */
export async function goLiveFromTray(page: Page) {
  const tray = page.getByTestId('release-status')
  await expect(tray).toHaveAttribute('data-state', /ready|never-live/)
  await expect(async () => {
    const state = await tray.getAttribute('data-state')
    if (state === 'ready' || state === 'never-live') {
      await tray.getByTestId('publish-site').click({ timeout: 5_000 })
    }
    await expect(tray).toHaveAttribute('data-state', /going-live|up-to-date/, {
      timeout: 10_000,
    })
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] })
  await expect(tray).toHaveAttribute('data-state', 'up-to-date', {
    timeout: 45_000,
  })
}

/** Rows of the Go‑live panel's releases timeline. */
export function releases(panel: Locator) {
  return panel.getByTestId('publications')
}

/* ------------------------------------------------------------------------
   Mail (Mailpit)
------------------------------------------------------------------------ */

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

type MailpitMessage = {
  ID: string
  Subject: string
  To: Array<{ Address?: string }>
}

/** The invitation link e-mailed to `email` (polls Mailpit). */
export async function waitForInviteLink(email: string, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const list = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    )
    if (list.ok) {
      const body = (await list.json()) as { messages?: MailpitMessage[] }
      const match = (body.messages ?? []).find((msg) =>
        msg.Subject.startsWith('Invitation to'),
      )
      if (match) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)
        const full = (await detail.json()) as { HTML?: string; Text?: string }
        const href = `${full.Text ?? ''} ${full.HTML ?? ''}`.match(
          /https?:\/\/[^\s"'<>]+\/invite\/[A-Za-z0-9_-]+/,
        )?.[0]
        if (href) return href
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`No invitation e-mail for ${email} in Mailpit`)
}

/* ------------------------------------------------------------------------
   Site content (globals)
------------------------------------------------------------------------ */

/** A section config as `areca manifest push` sends it (`globals` key). */
export type GlobalManifestConfig = {
  label?: string
  fields: object[]
  seo?: boolean
  previewPath?: string
}

/** One required email and an optional phone, both under a "Contact" heading. */
export const COMPANY_INFO_GLOBAL: GlobalManifestConfig = {
  label: 'Company info',
  fields: [
    {
      key: 'email',
      label: 'Email',
      type: 'text',
      required: true,
      group: 'Contact',
    },
    { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
  ],
}

/** The Articles manifest plus site content sections. */
export function manifestWithGlobals(
  globals: Record<string, GlobalManifestConfig>,
): object {
  return { ...ARTICLES_MANIFEST, globals }
}

/**
 * Pushes a manifest to a site created by `createIsolatedAcmeSite` (which
 * signs out, leaving the page on the CMS origin). Uses the schema token.
 */
export async function pushSiteManifest(
  page: Page,
  site: CreatedSite,
  manifest: object,
) {
  await pushManifest(new URL(page.url()).origin, site.schemaToken, manifest)
}

/** Same serializer as Start, so stubbed replies decode like real ones. */
const require = createRequire(
  realpathSync(
    new URL(
      '../node_modules/@tanstack/react-start/package.json',
      import.meta.url,
    ),
  ),
)
// eslint-disable-next-line import/no-commonjs -- Resolve Start's own transitive serializer without adding an application dependency.
const { toJSON } = require('seroval') as {
  toJSON: (value: unknown) => { t: unknown }
}

/**
 * Stubs AI availability and the translate server function, so the editor
 * shows the AI actions and the reply is fixed. Nothing reaches a provider.
 * `translated` is read at request time, so a test can change the reply.
 */
export async function stubAi(page: Page, translated: Record<string, string>) {
  const ids = new Map<string, string>()
  for (const file of ['/src/server/fn/ai.ts', '/src/server/fn/translate.ts']) {
    const source = await (await page.request.get(file)).text()
    for (const match of source.matchAll(/createClientRpc\("([^"]+)"\)/g)) {
      const id = match[1]
      const decoded = JSON.parse(Buffer.from(id, 'base64url').toString()) as {
        export: string
      }
      ids.set(decoded.export.split('_createServerFn')[0], id)
    }
  }
  const availability = ids.get('getAiAvailabilityFn')
  const translate = ids.get('translateContentFn')
  expect(availability && translate).toBeTruthy()
  const reply = (result: unknown) => ({
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-tss-serialized': 'true',
    },
    body: JSON.stringify(toJSON({ result, error: undefined, context: {} }).t),
  })
  await page.route(`**/_serverFn/${availability}**`, (route) =>
    route.fulfill(reply({ enabled: true })),
  )
  await page.route(`**/_serverFn/${translate}**`, (route) =>
    route.fulfill(reply({ values: { ...translated }, skipped: [] })),
  )
  await page.route('https://openrouter.ai/**', (route) => route.abort())
}

/* ------------------------------------------------------------------------
   Agency: people (accounts, invitations, the person page)
------------------------------------------------------------------------ */

/** Creates a client from Agency › Clients and returns its slug. */
export async function createAgencyClient(page: Page, name: string) {
  await page.goto('/agency/clients')
  await expect(page.getByTestId('organizations-page')).toBeVisible()
  await hydrated(page)
  await page.getByTestId('new-organization').first().click()
  await page.getByTestId('org-name').fill(name)
  await page.getByTestId('create-client').click()
  const slug = slugify(name)
  await expect(page.getByTestId('client-slug')).toHaveText(slug)
  return slug
}

/** Agency › People, hydrated. */
export async function openAgencyPeople(page: Page) {
  await page.goto('/agency/people')
  await expect(page.getByTestId('agency-people')).toBeVisible()
  await hydrated(page)
}

/**
 * Filters the people list by a search term and opens that person's page.
 * Returns the user id from the URL.
 */
export async function openPersonPage(page: Page, email: string) {
  await openAgencyPeople(page)
  await page.getByRole('searchbox').fill(email)
  await page.getByTestId(`person-link-${email}`).click()
  await expect(page.getByTestId('person-page')).toBeVisible()
  await expect(page.getByTestId('person-page')).toHaveAttribute(
    'data-ready',
    'true',
  )
  const id = page.url().match(/\/agency\/people\/([^/?#]+)/)?.[1]
  expect(id, 'user id in the URL').toBeTruthy()
  return id!
}

/**
 * Invites `email` to each client with the given role, from the Invite person
 * sheet on Agency › People. The sheet closes after the last send.
 */
export async function inviteToClients(
  page: Page,
  email: string,
  picks: Array<{ slug: string; name: string; role: 'owner' | 'editor' }>,
) {
  await openAgencyPeople(page)
  await page.getByTestId('invite-person').click()
  const sheet = page.getByTestId('invite-person-sheet')
  await expect(sheet).toBeVisible()
  await page.getByTestId('invite-person-email').fill(email)
  for (const pick of picks) {
    await page.getByTestId('invite-person-clients-add').click()
    await expect(page.getByTestId('client-picker')).toBeVisible()
    await page.getByTestId('client-picker-search').fill(pick.name)
    await page.getByTestId(`client-picker-option-${pick.slug}`).click()
    if (pick.role === 'owner') {
      await page.getByTestId('client-picker-role-owner').click()
    }
    await page.getByTestId('client-picker-add').click()
    await expect(page.getByTestId('client-picker')).toBeHidden()
    await expect(
      page.getByTestId(`invite-person-pick-${pick.slug}`),
    ).toBeVisible()
  }
  await page.getByTestId('invite-person-send').click()
  await expect(sheet).toBeHidden()
}

/**
 * Follows the e-mailed invitation in a fresh browser context and joins as
 * `name`. Used to give the people tests real accounts to act on.
 */
export async function acceptInvitation(
  browser: Browser,
  email: string,
  name: string,
) {
  const link = await waitForInviteLink(email)
  const context = await browser.newContext()
  const guest = await context.newPage()
  await guest.goto(link)
  const form = await authForm(guest)
  await guest.getByLabel('Name', { exact: true }).fill(name)
  await guest.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await form.getByRole('button', { name: 'Create account and join' }).click()
  await expect(guest).not.toHaveURL(/\/invite\//, { timeout: 30_000 })
  await context.close()
}
