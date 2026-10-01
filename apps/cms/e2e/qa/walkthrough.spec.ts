/**
 * QA walkthrough: one serial tour of the whole product on an EMPTY CMS, with
 * a numbered screenshot at every step (see qa/helpers.ts for the folder).
 *
 *   agency setup → client → site (+ manifest) → invitations via Mailpit →
 *   editor writes → owner reviews and goes live → restore a release →
 *   Library and Activity → branding → phone
 *
 * It wipes the database first and restores the seed at the end, so run it
 * against the isolated stack: `pnpm test:e2e:qa:isolated`.
 */
import { execSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import {
  authForm,
  backToCollection,
  expectDisabledWithReason,
  expectToast,
  goLiveFromTray,
  hydrated,
  login,
  markAsReady,
  openAgency,
  openCollection,
  openGoLivePanel,
  pushManifest,
  richText,
  signOut,
  slugify,
  startNewEntry,
  titleInput,
  waitForInviteLink,
  waitForSaved,
} from '../helpers'
import {
  CMS_ROOT,
  QA_PASSWORD,
  QA_PNG,
  logIssue,
  screenshot,
  watchErrors,
  writeIssues,
} from './helpers'

const ADMIN = 'qa-admin@areca.local'
const OWNER = 'qa-owner@example.com'
const EDITOR = 'qa-editor@example.com'
const SITE_NAME = 'Acme Website'
const SITE_SLUG = 'acme-website'
const WELCOME = 'Welcome to Acme'
const SHIPPING = 'Shipping the first release'

const state = { siteId: '', token: '' }

function runCmsScript(script: string) {
  execSync(`pnpm -s ${script}`, { cwd: CMS_ROOT, stdio: 'inherit', env: process.env })
}

const MANIFEST = {
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
        { key: 'heroImage', label: 'Hero image', type: 'image' },
        { key: 'category', label: 'Category', type: 'select', options: ['news', 'updates'] },
      ],
    },
    pages: {
      route: '/$slug',
      label: 'Pages',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'body', label: 'Body', type: 'richtext' },
      ],
    },
  },
}

async function signIn(page: Page, email: string) {
  await login(page, email, QA_PASSWORD)
}

async function acceptInvite(browser: Browser, email: string, name: string) {
  const link = await waitForInviteLink(email)
  const context = await browser.newContext()
  const page = await context.newPage()
  watchErrors(page, `invite ${email}`)
  await page.goto(link)
  await authForm(page)
  await expect(page.getByRole('heading', { name: 'Acme invited you' })).toBeVisible()
  await screenshot(page, `invite-${name.split(' ')[1].toLowerCase()}`)
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: 'Create account and join' }).click()
  await expect(page).toHaveURL(/\/sites\/[^/]+/)
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await screenshot(page, `joined-${name.split(' ')[1].toLowerCase()}`)
  await context.close()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  runCmsScript('db:reset')
})

test.afterAll(() => {
  writeIssues()
  // Leave the seed behind for the regular suite.
  runCmsScript('db:reset')
  runCmsScript('db:seed')
})

test.beforeEach(({ page }, testInfo) => {
  watchErrors(page, testInfo.title)
})

test('01 agency setup', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup/)
  const form = await authForm(page)
  await screenshot(page, 'setup')
  await page.getByLabel('Name').fill('QA Admin')
  await page.getByLabel('Email').fill(ADMIN)
  await page.getByLabel('Password').fill(QA_PASSWORD)
  await page
    .getByLabel('Setup token')
    .fill(process.env.SETUP_TOKEN ?? 'e2e-setup-token-0123456789')
  await form.getByRole('button', { name: 'Create admin account' }).click()
  await expect(page).toHaveURL(/\/agency$/)
  await expect(page.getByTestId('get-started')).toBeVisible()
  await screenshot(page, 'agency-getting-started')
})

test('02 client, site and content model', async ({ page }) => {
  await signIn(page, ADMIN)
  await expect(page).toHaveURL(/\/agency$/)

  // Checklist step 1 opens the New client sheet.
  await page.getByTestId('get-started-client-action').click()
  await expect(page.getByTestId('new-client-sheet')).toBeVisible()
  await page.getByTestId('org-name').fill('Acme')
  await expect(page.getByTestId('org-slug')).toHaveValue('acme')
  await screenshot(page, 'new-client-sheet')
  await page.getByTestId('create-client').click()
  await expect(page.getByTestId('organization-page')).toBeVisible()
  await screenshot(page, 'client-empty')

  // New site: two steps with the one-time token.
  await page.getByTestId('new-site').first().click()
  await page.getByTestId('site-name').fill(SITE_NAME)
  await expect(page.getByTestId('site-slug')).toHaveValue(SITE_SLUG)
  await page.getByTestId('site-production-url').fill('https://acme.example.com')
  await screenshot(page, 'new-site-step-1')
  await page.getByTestId('create-site').click()
  await expect(page.getByTestId('site-token-alert')).toBeVisible()
  state.token = (await page.getByTestId('site-token-value').innerText()).trim()
  await screenshot(page, 'new-site-step-2-token')
  await page.getByTestId('token-saved').click()
  await expect(page.getByTestId(`client-site-${SITE_SLUG}`)).toBeVisible()
  await screenshot(page, 'client-with-site')

  // The site project pushes its manifest with the token.
  await pushManifest(new URL(page.url()).origin, state.token, MANIFEST)

  await page.getByTestId(`site-settings-${SITE_SLUG}`).click()
  await expect(page.getByTestId('site-settings')).toBeVisible()
  state.siteId = page.url().match(/\/sites\/([^/?#]+)/)?.[1] ?? ''
  await screenshot(page, 'settings-general')
  await page.getByRole('tab', { name: 'Deployment' }).click()
  await expect(page.getByTestId('settings-deployment')).toBeVisible()
  await screenshot(page, 'settings-deployment')
  await page.getByRole('tab', { name: 'Developer' }).click()
  await expect(page.getByTestId('manifest-status')).toContainText('Articles')
  await screenshot(page, 'settings-developer')
  await page.getByRole('tab', { name: 'Content' }).click()
  await expect(page.getByTestId('content-type-articles')).toBeVisible()
  await expect(page.getByTestId('content-type-pages')).toBeVisible()
  await screenshot(page, 'settings-content')
  await page.getByTestId('content-type-articles').click()
  await expect(page.getByTestId('collection-drawer')).toBeVisible()
  await expect(page.getByTestId('field-row-0')).toHaveAttribute('data-locked', 'true')
  await screenshot(page, 'schema-editor')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('collection-drawer')).toBeHidden()

  await openAgency(page)
  // The manifest arrived out of band; load the overview fresh.
  await page.reload()
  await hydrated(page)
  await expect(page.getByTestId('get-started-client')).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('get-started-site')).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('get-started-connect')).toHaveAttribute('data-done', 'true')
  await screenshot(page, 'agency-checklist-progress')
})

test('03 invitations via Mailpit', async ({ page, browser }) => {
  await signIn(page, ADMIN)
  await page.goto(`/sites/${state.siteId}/people`)
  await expect(page.getByTestId('people-page')).toBeVisible()
  await hydrated(page)
  await screenshot(page, 'people-empty')

  await page.getByTestId('invite-member').click()
  await page.getByTestId('invite-email').fill(OWNER)
  await page.getByTestId('invite-role-owner').click()
  await screenshot(page, 'invite-sheet')
  await page.getByTestId('invite-send').click()
  await expectToast(page, 'Invitation sent')

  await page.getByTestId('invite-member').click()
  await page.getByTestId('invite-email').fill(EDITOR)
  await page.getByTestId('invite-send').click()
  await expectToast(page, 'Invitation sent')
  await expect(page.getByTestId(`invitation-row-${OWNER}`)).toBeVisible()
  await expect(page.getByTestId(`invitation-row-${EDITOR}`)).toBeVisible()
  await screenshot(page, 'people-invitations')

  await acceptInvite(browser, OWNER, 'QA Owner')
  await acceptInvite(browser, EDITOR, 'QA Editor')

  await page.reload()
  await hydrated(page)
  await expect(page.getByTestId(`member-row-${OWNER}`)).toBeVisible()
  await expect(page.getByTestId(`member-row-${EDITOR}`)).toBeVisible()
  await screenshot(page, 'people-members')
})

test('04 the editor writes drafts', async ({ page }) => {
  await signIn(page, EDITOR)
  // The editor's only site opens straight away.
  await expect(page).toHaveURL(new RegExp(`/sites/${state.siteId}`))
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await expect(page.getByTestId('sidebar').getByTestId('team-nav')).toHaveCount(0)
  await screenshot(page, 'editor-overview')

  await openCollection(page, 'articles')
  await expect(page.getByTestId('collection-empty')).toBeVisible()
  await screenshot(page, 'articles-empty')
  await startNewEntry(page)
  await screenshot(page, 'editor-new')

  await titleInput(page).fill(WELCOME)
  const body = richText(page)
  await body.click()
  await page.keyboard.type('Acme builds calm websites.')
  await page.keyboard.press('Enter')
  await page.getByTestId('rich-text-block-type').click()
  await page.getByRole('menuitem', { name: 'Heading 2' }).click()
  await page.keyboard.type('What we do')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Design, build and care.')
  await page
    .getByTestId('entry-details')
    .getByRole('button', { name: /Choose an image/ })
    .click()
  await page.getByTestId('media-picker').getByTestId('media-upload').setInputFiles({
    name: 'welcome-hero.png',
    mimeType: 'image/png',
    buffer: QA_PNG,
  })
  await expect(page.getByTestId('image-field-thumb')).toBeVisible()
  await waitForSaved(page)
  await screenshot(page, 'editor-writing')
  await expectDisabledWithReason(page, page.getByTestId('publish-now'))
  await screenshot(page, 'editor-mark-ready-disabled')

  await backToCollection(page)
  await startNewEntry(page)
  await titleInput(page).fill(SHIPPING)
  await richText(page).click()
  await page.keyboard.type('Version one is out.')
  await waitForSaved(page)
  await backToCollection(page)
  await expect(page.getByTestId(`entry-${slugify(SHIPPING)}`)).toBeVisible()
  await screenshot(page, 'articles-two-drafts')
  await expectDisabledWithReason(
    page,
    page.getByTestId('release-status').getByTestId('publish-site'),
  )
  await screenshot(page, 'editor-go-live-disabled')
})

test('05 the owner reviews and goes live', async ({ page }) => {
  await signIn(page, OWNER)
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await screenshot(page, 'owner-overview')

  await openCollection(page, 'articles')
  await page.getByTestId(`entry-${slugify(WELCOME)}`).getByRole('link').first().click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute('data-ready', 'true')
  await screenshot(page, 'owner-opens-draft')
  await markAsReady(page)
  await screenshot(page, 'owner-marked-ready')
  await backToCollection(page)

  // The second one through select mode.
  await page.getByTestId('select-mode').click()
  await page.getByRole('button', { name: `Select ${SHIPPING}`, exact: true }).click()
  await screenshot(page, 'select-mode')
  await page.getByTestId('bulk-ready').click()
  await expect(
    page.getByTestId(`entry-${slugify(SHIPPING)}`).getByTestId('entry-status'),
  ).toHaveAttribute('data-ui-status', 'ready')
  await page.getByTestId('bulk-done').click()
  await expect(page.getByTestId('release-status')).toContainText('2 changes ready')
  await screenshot(page, 'tray-two-ready')

  await goLiveFromTray(page)
  await screenshot(page, 'tray-live')
  const panel = await openGoLivePanel(page)
  await expect(panel.getByTestId('publication-live')).toContainText('by QA Owner')
  await screenshot(page, 'golive-panel-live')
})

test('06 restore an earlier release', async ({ page }) => {
  await signIn(page, OWNER)
  await openCollection(page, 'articles')
  await page.getByTestId(`entry-${slugify(WELCOME)}`).getByRole('link').first().click()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute('data-ready', 'true')
  await titleInput(page).fill(`${WELCOME} (updated)`)
  await waitForSaved(page)
  await markAsReady(page)
  await backToCollection(page)
  await goLiveFromTray(page)

  const panel = await openGoLivePanel(page)
  const replaced = panel.getByTestId('publication-superseded')
  await expect(replaced).toHaveCount(1)
  await screenshot(page, 'golive-two-releases')
  const id = await replaced.getAttribute('data-release-id')
  await replaced.getByTestId('publication-menu').click()
  await page.getByTestId('rollback-publication').click()
  await screenshot(page, 'restore-confirm')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore this version' }).click()
  await expect(panel.locator(`[data-release-id="${id}"]`)).toHaveAttribute(
    'data-testid',
    'publication-live',
    { timeout: 45_000 },
  )
  // The later edit stays ready to go live again.
  await expect(page.getByTestId('release-status')).toHaveAttribute('data-state', 'ready')
  await screenshot(page, 'golive-restored')
})

test('07 Library and Activity', async ({ page }) => {
  await signIn(page, OWNER)
  await page.getByTestId('sidebar').getByTestId('library-nav').click()
  await expect(page.getByTestId('library-page')).toBeVisible()
  const tile = page.getByTestId('media-card-welcome-hero.png')
  await expect(tile).toBeVisible()
  await screenshot(page, 'library')
  await tile.click()
  await page.getByLabel('Description (alt text)').fill('The Acme team at work')
  await page.getByLabel('Description (alt text)').press('Enter')
  await expect(page.getByTestId('asset-alt-status')).toContainText('Saved')
  await screenshot(page, 'library-detail')
  await page.keyboard.press('Escape')

  await page.goto(`/sites/${state.siteId}?panel=activity`)
  const activity = page.getByTestId('activity-panel')
  await expect(activity).toBeVisible()
  await expect(activity.getByTestId('activity-item').first()).toBeVisible()
  await screenshot(page, 'activity-panel')
  const text = await activity.innerText()
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-/.test(text)) {
    logIssue({ area: 'activity', severity: 'visual', note: 'Activity shows raw ids' })
  }
})

test('08 branding', async ({ page }) => {
  await signIn(page, ADMIN)
  await openAgency(page)
  await page.getByTestId('sidebar').getByTestId('branding-nav').click()
  await expect(page.getByTestId('branding-page')).toBeVisible()
  await screenshot(page, 'branding')
  await page.getByTestId('brand-name').fill('Acme Studio')
  await page.getByTestId('brand-preset-indigo').click()
  await page.getByTestId('save-branding').click()
  await expectToast(page, 'Branding saved')
  await expect(page.getByTestId('sidebar')).toContainText('Acme Studio')
  await screenshot(page, 'branding-saved')

  await signOut(page)
  await expect(page.getByText('Acme Studio').first()).toBeVisible()
  await screenshot(page, 'login-branded')

  await signIn(page, ADMIN)
  await page.goto('/agency/branding')
  await hydrated(page)
  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await page.getByTestId('reset-branding').getByRole('button', { name: 'Reset to defaults' }).click()
  await expectToast(page, 'Branding reset to defaults')
  await screenshot(page, 'branding-reset')
})

test('09 on a phone', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  watchErrors(page, 'phone')
  await signIn(page, OWNER)
  await expect(page.getByTestId('mobile-tab-bar')).toBeVisible()
  await hydrated(page)
  await screenshot(page, 'phone-overview')
  await page.getByTestId('mobile-content').click()
  await expect(page.getByRole('dialog', { name: 'Content' })).toBeVisible()
  await screenshot(page, 'phone-content-sheet')
  await page.getByRole('dialog', { name: 'Content' }).getByRole('link', { name: /Articles/ }).click()
  await expect(page.getByTestId('site-content')).toHaveAttribute('data-ready', 'true')
  await screenshot(page, 'phone-articles')
  await page.getByTestId('golive-pill').click()
  await expect(page.getByTestId('golive-panel')).toBeVisible()
  await screenshot(page, 'phone-golive')
  await context.close()
})
