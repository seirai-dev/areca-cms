import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  COMPANY_INFO_GLOBAL,
  OWNER,
  createIsolatedAcmeSite,
  expectDisabledWithReason,
  hydrated,
  login,
  manifestWithGlobals,
  openSite,
  pushSiteManifest,
  uniqueSuffix,
} from './helpers'
import type { CreatedSite, GlobalManifestConfig } from './helpers'

/** The built SDK bridge (packages/site-sdk/dist), served to the preview page as modules. */
const SDK_DIR = '/__sdk/'

/** The site content section with a preview path: the home page. */
const HOME_PAGE: GlobalManifestConfig = {
  label: 'Home page',
  previewPath: '/',
  seo: true,
  fields: [
    { key: 'heroEyebrow', label: 'Hero eyebrow', type: 'text' },
    { key: 'heroIntro', label: 'Hero intro', type: 'textarea' },
  ],
}

/** Serves a built SDK module (`visual.js` imports `visual-overlay.js`). */
function sdkModule(pathname: string) {
  const name = pathname.slice(SDK_DIR.length)
  if (!/^[a-z-]+\.js$/.test(name)) return null
  return readFileSync(
    fileURLToPath(
      new URL(`../../../packages/site-sdk/dist/${name}`, import.meta.url),
    ),
    'utf8',
  )
}

/**
 * A page with the real SDK bridge. The `heroIntro` text follows each update;
 * the footer carries a field owned by another section (`companyInfo`).
 */
function globalsBridgePage(cmsOrigin: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Georgia,serif;color:#1d1b16;background:#fbf8f2}
main{max-width:720px;margin:64px auto;padding:0 24px} p{font-size:19px;line-height:1.7}
footer{margin-top:640px;padding:24px 48px;font-family:system-ui}
</style></head><body>
<main><p data-areca-field="heroEyebrow">Welcome to the journal</p>
<p data-areca-field="heroIntro">The intro from the saved draft.</p></main>
<footer><span data-areca-field="email" data-areca-global="companyInfo">hello@acme.test</span></footer>
<script type="module">
import { createVisualBridge } from '${SDK_DIR}visual.js'
createVisualBridge({
  cmsOrigin: ${JSON.stringify(cmsOrigin)},
  onUpdate(result) {
    document.querySelector('[data-areca-field="heroIntro"]').textContent = result.entry.data.heroIntro || 'Roasted in small batches.'
  },
})
</script></body></html>`
}

/**
 * Serves the site's preview pages with the bridge and counts document loads,
 * so a test can tell when the frame reloaded. The CMS origin is read from the
 * editor page at request time.
 */
async function serveGlobalsPreview(page: Page, siteOrigin: string) {
  let documents = 0
  await page.route(`${siteOrigin}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.startsWith(SDK_DIR)) {
      const body = sdkModule(pathname)
      return body === null
        ? route.fulfill({ status: 404, body: '' })
        : route.fulfill({ contentType: 'text/javascript', body })
    }
    if (route.request().resourceType() === 'document') documents += 1
    return route.fulfill({
      contentType: 'text/html',
      body: globalsBridgePage(new URL(page.url()).origin),
    })
  })
  return { count: () => documents }
}

/**
 * A fresh site with the home page and company info sections, opened as the
 * owner. The site's production URL is the preview origin: no Preview URL is
 * set, so previews load from `productionUrl` (see `previewBaseUrl`).
 */
async function openGlobalsSite(page: Page, suffix: string) {
  const site: CreatedSite = await createIsolatedAcmeSite(page, suffix)
  await pushSiteManifest(
    page,
    site,
    manifestWithGlobals({
      homePage: HOME_PAGE,
      companyInfo: COMPANY_INFO_GLOBAL,
    }),
  )
  await login(page, OWNER)
  await openSite(page, site.siteSlug)
  return site
}

/** Sidebar item for a section, then wait until the section editor is ready. */
async function openSection(page: Page, key: string) {
  await page
    .getByTestId('sidebar')
    .getByTestId(`site-content-item-${key}`)
    .click()
  await expect(page).toHaveURL(new RegExp(`/globals/${key}(?:\\?.*)?$`))
  await expect(page.getByTestId('global-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await hydrated(page, page.getByTestId('global-editor'))
}

/** Visual's segment in the Write | Visual control. */
function visualSegment(page: Page) {
  return page.getByTestId('editor-mode-visual')
}

function statusBadge(page: Page) {
  return page.getByTestId('visual-status')
}

function previewFrame(page: Page) {
  return page.frameLocator('[data-testid="visual-frame"]')
}

/** The preview frame's document, for markers and reload checks. */
function previewDocument(page: Page, siteOrigin: string) {
  const frame = page
    .frames()
    .find((candidate) => candidate.url().startsWith(siteOrigin))
  if (!frame) throw new Error('the preview frame has no document yet')
  return frame
}

async function openVisual(page: Page) {
  await visualSegment(page).click()
  await expect(page.getByTestId('visual-editor')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page).toHaveURL(/[?&]view=visual(?:&|$)/)
}

test('site content with a preview path opens in Visual mode and shows the page', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const site = await openGlobalsSite(page, `glob-visual-${uniqueSuffix()}`)
  await serveGlobalsPreview(page, site.productionUrl)
  await openSection(page, 'homePage')

  await openVisual(page)
  await expect(page.getByTestId('visual-frame')).toHaveAttribute(
    'src',
    /arecaPreview=/,
  )

  // Visual survives a reload because the URL carries it.
  await page.reload()
  await expect(page.getByTestId('visual-editor')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page).toHaveURL(/[?&]view=visual(?:&|$)/)
})

test('a section without a preview path keeps Visual disabled with a reason', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openGlobalsSite(page, `glob-visual-${uniqueSuffix()}`)
  await openSection(page, 'companyInfo')

  await expectDisabledWithReason(
    page,
    visualSegment(page),
    'Preview is not set up for this section yet',
  )
  await expect(page.getByTestId('visual-editor')).toHaveCount(0)
})

test('live: typing in a section field updates the frame without a reload', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const site = await openGlobalsSite(page, `glob-visual-${uniqueSuffix()}`)
  const preview = await serveGlobalsPreview(page, site.productionUrl)
  await openSection(page, 'homePage')
  await openVisual(page)
  await expect(statusBadge(page)).toHaveAttribute('data-tier', 'live', {
    timeout: 15_000,
  })

  // A marker on the page: a reload would clear it.
  await expect.poll(() => preview.count()).toBeGreaterThan(0)
  await previewDocument(page, site.productionUrl).evaluate(() => {
    document.body.dataset.marker = 'kept'
  })
  const documentsBefore = preview.count()

  const next = `Live intro ${uniqueSuffix()}`
  await page.getByLabel('Hero intro', { exact: true }).fill(next)
  await expect(
    previewFrame(page).locator('[data-areca-field="heroIntro"]'),
  ).toHaveText(next, { timeout: 10_000 })

  // Autosave runs after the live update; the frame must not reload for it.
  await expect(page.getByTestId('global-editor')).toHaveAttribute(
    'data-dirty',
    'false',
    { timeout: 30_000 },
  )
  await page.waitForTimeout(1500)
  expect(preview.count()).toBe(documentsBefore)
  expect(
    await previewDocument(page, site.productionUrl).evaluate(
      () => document.body.dataset.marker,
    ),
  ).toBe('kept')
})

test('click to edit: clicking a marked element focuses the section field', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const site = await openGlobalsSite(page, `glob-visual-${uniqueSuffix()}`)
  await serveGlobalsPreview(page, site.productionUrl)
  await openSection(page, 'homePage')
  await openVisual(page)
  await expect(statusBadge(page)).toHaveAttribute('data-clickable', 'true', {
    timeout: 15_000,
  })

  // Move focus away first, so the click is what focuses the intro.
  await page.getByLabel('Hero eyebrow', { exact: true }).focus()
  await previewFrame(page).locator('[data-areca-field="heroIntro"]').click()
  await expect(page.locator('[data-field="heroIntro"] textarea')).toBeFocused()
})

test('a footer marked with another section opens the Open popover', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const site = await openGlobalsSite(page, `glob-visual-${uniqueSuffix()}`)
  await serveGlobalsPreview(page, site.productionUrl)
  await openSection(page, 'homePage')
  await openVisual(page)
  await expect(statusBadge(page)).toHaveAttribute('data-clickable', 'true', {
    timeout: 15_000,
  })

  await previewFrame(page)
    .locator('[data-areca-field="email"][data-areca-global="companyInfo"]')
    .click()
  const popover = page.getByTestId('visual-owner-popover')
  await expect(popover).toBeVisible({ timeout: 10_000 })
  await expect(popover).toContainText('Company info')

  await page.getByTestId('visual-owner-open').click()
  await expect(page).toHaveURL(/\/globals\/companyInfo(?:\?.*)?$/)
  // Company info has no preview path, so it opens in Write mode.
  await expect(page.getByTestId('global-editor')).toHaveAttribute(
    'data-view',
    'write',
  )
  await expect(page).not.toHaveURL(/view=visual/)
})
