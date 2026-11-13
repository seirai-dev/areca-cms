import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ACME_SITE,
  OWNER,
  backToCollection,
  createArticle,
  expectDisabledWithReason,
  login,
  openAccountMenu,
  openCollection,
  openSite,
  startNewEntry,
  titleInput,
  uniqueSuffix,
} from './helpers'

/** The seeded site's production URL (scripts/seed.ts). Previews load from here. */
const SITE_ORIGIN = 'http://localhost:3001'
const SITE_ROUTE = `${SITE_ORIGIN}/**`

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Georgia,serif;color:#1d1b16;background:#fbf8f2}
header{display:flex;justify-content:space-between;align-items:center;padding:20px 48px;border-bottom:1px solid #e7e0d2;font-family:system-ui;font-size:14px}
header b{font-size:18px} nav a{margin-left:24px;color:#1d1b16;text-decoration:none}
main{max-width:720px;margin:64px auto;padding:0 24px} h1{font-size:48px;line-height:1.1;margin:0 0 16px}
.meta{font-family:system-ui;color:#7a7263;font-size:14px;margin-bottom:32px}
.hero{height:320px;border-radius:12px;background:linear-gradient(135deg,#c9a46a,#6b4a2b);margin-bottom:32px}
p{font-size:19px;line-height:1.7} @media(max-width:800px){h1{font-size:32px}header{padding:16px 20px}nav{display:none}}
</style></head><body><header><b>Acme Journal</b><nav><a href="/">Home</a><a href="/journal">Journal</a><a href="/about">About</a></nav></header>
<main><div class="meta">Journal · 29 October 2026</div><h1>__TITLE__</h1><div class="hero"></div>
<p>Every roast starts with a question: what does this bean want to taste like? We spent a season in the hills finding out.</p>
<p>Below the fold there is more text, so the preview has something to scroll through when the editor checks the layout.</p></main></body></html>`

/**
 * Serves the site's preview pages from a fixture and counts the requests, so
 * a test can tell when the frame reloaded.
 */
async function servePreview(page: Page) {
  let requests = 0
  await page.route(SITE_ROUTE, (route) => {
    requests += 1
    return route.fulfill({
      contentType: 'text/html',
      body: FIXTURE.replace('__TITLE__', 'A season in the hills'),
    })
  })
  return { count: () => requests }
}

/** Visual's segment in the Write | Visual control. */
function visualSegment(page: Page) {
  return page.getByTestId('editor-mode-visual')
}

async function openVisual(page: Page) {
  await visualSegment(page).click()
  await expect(page.getByTestId('visual-editor')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page).toHaveURL(/[?&]view=visual(?:&|$)/)
}

/** Logs in, opens the seeded site's Articles and creates a saved entry. */
async function savedEntry(page: Page, title: string) {
  await login(page, OWNER)
  await openSite(page, ACME_SITE)
  await openCollection(page, 'articles')
  await createArticle(page, title)
  return page.url()
}

async function frameBox(page: Page) {
  const box = await page.getByTestId('visual-frame').boundingBox()
  if (!box) throw new Error('visual frame has no box')
  return box
}

/** The Write | Visual layout at each width that offers Visual mode. */
for (const width of [1280, 1440, 1920]) {
  test(`visual mode at ${width}px: toggle, frame, URL, reload, write, remembered`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await servePreview(page)
    const title = `Visual ${width} ${uniqueSuffix()}`
    const entryUrl = await savedEntry(page, title)

    await expect(visualSegment(page)).toBeEnabled()
    await openVisual(page)
    await expect(page.getByTestId('visual-editor-column')).toBeVisible()
    await expect(page.getByTestId('visual-divider')).toBeVisible()
    await expect(page.getByTestId('visual-frame')).toHaveAttribute(
      'src',
      /token=/,
    )

    // Visual survives a reload because the URL carries it.
    await page.reload()
    await expect(page.getByTestId('visual-editor')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page).toHaveURL(/view=visual/)

    await page.getByTestId('editor-mode-write').click()
    await expect(page.getByTestId('visual-editor')).toHaveCount(0)
    await expect(page).not.toHaveURL(/view=visual/)

    // Mode is remembered per browser: another entry opens in Visual again.
    await openVisual(page)
    await backToCollection(page)
    await createArticle(page, `${title} second`)
    await page.goto(entryUrl)
    await expect(page.getByTestId('visual-editor')).toBeVisible({
      timeout: 30_000,
    })
  })
}

for (const width of [1024, 390]) {
  test(`visual mode is hidden at ${width}px and ?view=visual renders Write`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const entryUrl = await savedEntry(page, `Hidden ${width} ${uniqueSuffix()}`)

    await page.setViewportSize({ width, height: 800 })
    await page.goto(entryUrl)
    await expect(page.getByTestId('entry-editor')).toHaveAttribute(
      'data-ready',
      'true',
      { timeout: 30_000 },
    )
    await expect(page.getByTestId('editor-mode')).toHaveCount(0)
    await expect(page.getByTestId('editor-mode-visual')).toHaveCount(0)

    if (width === 1024) {
      await page.goto(`${entryUrl}?view=visual`)
      await expect(page.getByTestId('entry-editor')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30_000 },
      )
      await expect(page.getByTestId('visual-editor')).toHaveCount(0)
      await expect(page.getByTestId('entry-editor')).toHaveAttribute(
        'data-view',
        'write',
      )
    }
  })
}

test('a new entry shows Visual as unavailable until the first save', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, OWNER)
  await openSite(page, ACME_SITE)
  await openCollection(page, 'articles')
  await startNewEntry(page)

  await expectDisabledWithReason(
    page,
    visualSegment(page),
    'Available after the first save',
  )
})

test('autosave reloads the preview frame and the Reload button reloads it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const preview = await servePreview(page)
  await savedEntry(page, `Autosave ${uniqueSuffix()}`)
  await openVisual(page)
  await expect.poll(() => preview.count()).toBeGreaterThan(0)

  const beforeSave = preview.count()
  await titleInput(page).fill(`Autosave renamed ${uniqueSuffix()}`)
  await expect
    .poll(() => preview.count(), { timeout: 30_000 })
    .toBeGreaterThan(beforeSave)

  const beforeReload = preview.count()
  await page.getByTestId('visual-reload').click()
  await expect
    .poll(() => preview.count(), { timeout: 15_000 })
    .toBeGreaterThan(beforeReload)
})

test('width presets: desktop fills, tablet 768, mobile 390, fit 1440 scales, remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await servePreview(page)
  await savedEntry(page, `Widths ${uniqueSuffix()}`)
  await openVisual(page)

  const pane = await page.getByTestId('visual-preview').boundingBox()
  expect(pane).not.toBeNull()

  await page.getByTestId('visual-width-desktop').click()
  expect((await frameBox(page)).width).toBeCloseTo(pane!.width, 0)

  await page.getByTestId('visual-width-tablet').click()
  await expect
    .poll(async () => Math.round((await frameBox(page)).width))
    .toBe(768)

  await page.getByTestId('visual-width-mobile').click()
  await expect
    .poll(async () => Math.round((await frameBox(page)).width))
    .toBe(390)

  await page.getByTestId('visual-width-fit1440').click()
  await expect(page.getByTestId('visual-width-fit1440')).toHaveAttribute(
    'data-state',
    'on',
  )
  // The frame renders at 1440 px and a transform scales it into the pane.
  const scale = await page.getByTestId('visual-frame').evaluate((el) => {
    const transform = getComputedStyle(el.parentElement!).transform
    const match = /matrix\(([^,]+)/.exec(transform)
    return match ? Number(match[1]) : 1
  })
  expect(scale).toBeLessThan(1)
  expect(scale).toBeGreaterThan(0)

  await page.getByTestId('visual-width-tablet').click()
  await page.reload()
  await expect(page.getByTestId('visual-width-tablet')).toHaveAttribute(
    'data-state',
    'on',
    { timeout: 30_000 },
  )
})

test('divider: arrow keys widen the column, double-click resets, ratio remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `Divider ${uniqueSuffix()}`)
  await openVisual(page)

  const column = page.getByTestId('visual-editor-column')
  const defaultWidth = (await column.boundingBox())!.width

  const divider = page.getByTestId('visual-divider')
  await divider.focus()
  await divider.press('ArrowRight')
  await expect
    .poll(async () => (await column.boundingBox())!.width)
    .toBeGreaterThan(defaultWidth + 8)
  const widened = (await column.boundingBox())!.width

  // The ratio (not pixels) is what gets stored.
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('areca:visual:ratio'),
  )
  expect(Number(stored)).toBeGreaterThan(0)
  expect(Number(stored)).toBeLessThan(1)

  await page.reload()
  await expect(page.getByTestId('visual-editor')).toBeVisible({
    timeout: 30_000,
  })
  await expect
    .poll(async () => Math.round((await column.boundingBox())!.width))
    .toBeCloseTo(Math.round(widened), -1)

  await page.getByTestId('visual-divider').dblclick()
  await expect
    .poll(async () => Math.round((await column.boundingBox())!.width))
    .toBeCloseTo(Math.round(defaultWidth), -1)
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem('areca:visual:ratio'),
    ),
  ).toBeNull()
})

test('full screen button enters, Esc exits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `Fullscreen ${uniqueSuffix()}`)
  await openVisual(page)

  await page.getByTestId('visual-fullscreen').click()
  const preview = page.getByTestId('visual-preview')
  await expect(preview).toHaveAttribute('data-fullscreen', 'true')
  const exit = page.getByTestId('visual-exit-fullscreen')
  await expect(exit).toBeVisible()
  await expect(exit).toHaveText(/Exit full screen/)

  const viewport = page.viewportSize()!
  expect((await frameBox(page)).width).toBeGreaterThanOrEqual(
    viewport.width - 1,
  )

  await page.keyboard.press('Escape')
  await expect(preview).toHaveAttribute('data-fullscreen', 'false')
})

test('the Exit full screen button leaves full screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `Exit button ${uniqueSuffix()}`)
  await openVisual(page)

  await page.getByTestId('visual-fullscreen').click()
  await expect(page.getByTestId('visual-preview')).toHaveAttribute(
    'data-fullscreen',
    'true',
  )
  await page.getByTestId('visual-exit-fullscreen').click()
  await expect(page.getByTestId('visual-preview')).toHaveAttribute(
    'data-fullscreen',
    'false',
  )
})

test('mod+Shift+Enter toggles full screen in Visual mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `Fullscreen key ${uniqueSuffix()}`)
  await openVisual(page)

  const preview = page.getByTestId('visual-preview')
  await page.keyboard.press('ControlOrMeta+Shift+Enter')
  await expect(preview).toHaveAttribute('data-fullscreen', 'true')
  await page.keyboard.press('ControlOrMeta+Shift+Enter')
  await expect(preview).toHaveAttribute('data-fullscreen', 'false')
})

test('mod+Shift+E toggles between Write and Visual', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `Mode key ${uniqueSuffix()}`)
  // Visual, and its shortcut, wait for the entry's preview URL to load.
  await expect(visualSegment(page)).toBeEnabled()

  await page.keyboard.press('ControlOrMeta+Shift+E')
  await expect(page.getByTestId('visual-editor')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page).toHaveURL(/view=visual/)

  await page.keyboard.press('ControlOrMeta+Shift+E')
  await expect(page.getByTestId('visual-editor')).toHaveCount(0)
  await expect(page).not.toHaveURL(/view=visual/)
})

test('the command palette lists the visual command and running it switches mode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `Palette ${uniqueSuffix()}`)

  await page.keyboard.press('ControlOrMeta+K')
  const palette = page.getByTestId('command-palette')
  await expect(palette).toBeVisible()
  await palette.getByRole('option', { name: 'Open visual editor' }).click()

  await expect(page.getByTestId('visual-editor')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page).toHaveURL(/view=visual/)

  // The same palette now offers the way back.
  await page.keyboard.press('ControlOrMeta+K')
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await page
    .getByTestId('command-palette')
    .getByRole('option', { name: 'Back to writing' })
    .click()
  await expect(page.getByTestId('visual-editor')).toHaveCount(0)
})

test('the keyboard shortcuts dialog lists both visual shortcuts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, OWNER)
  await openSite(page, ACME_SITE)

  await openAccountMenu(page)
  await page.getByTestId('open-shortcuts').click()
  const dialog = page.getByTestId('shortcuts-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Switch to visual editor')
  await expect(dialog).toContainText('Full screen preview')
  // The modifier follows the OS (⌘ or Ctrl) and Shift follows it too (⇧ or Shift).
  await expect(dialog).toContainText(/⌘|Ctrl/)
  await expect(dialog).toContainText(/⇧|Shift/)
})

test('the New dot shows before the first visit to Visual and clears after it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `New dot ${uniqueSuffix()}`)

  await expect(page.getByTestId('visual-new-dot')).toBeVisible()
  await expect(page.getByTestId('visual-new-dot')).toContainText('New')

  await openVisual(page)
  await expect(page.getByTestId('visual-new-dot')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('visual-editor')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByTestId('visual-new-dot')).toHaveCount(0)
})

test('the View draft link still opens a signed preview in both modes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await servePreview(page)
  await savedEntry(page, `View draft ${uniqueSuffix()}`)

  const link = page.getByTestId('preview-entry').first()
  await expect(link).toHaveAttribute('href', /[?&]token=/)

  await openVisual(page)
  await expect(page.getByTestId('preview-entry').first()).toHaveAttribute(
    'href',
    /[?&]token=/,
  )
  await expect(page.getByTestId('preview-entry').first()).toHaveAttribute(
    'target',
    '_blank',
  )
})

/** The built SDK bridge (packages/site-sdk/dist), served to the preview page as modules. */
const SDK_PATH = '/__sdk/visual.js'
const SDK_DIR = '/__sdk/'

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
const BRIDGE_TITLE = 'A season in the hills'
const LIVE_ENDPOINT = '**/api/editor/live-preview'

/**
 * The fixture page with the real SDK bridge: its module imports
 * `createVisualBridge` from the SDK path and writes each update into the page.
 */
function bridgePage(cmsOrigin: string, title: string) {
  return FIXTURE.replace('__TITLE__', title).replace(
    '</body>',
    `<script type="module">
import { createVisualBridge } from '${SDK_PATH}'
createVisualBridge({
  cmsOrigin: ${JSON.stringify(cmsOrigin)},
  onUpdate(result, info) {
    document.querySelector('h1').textContent = result.entry.data.title
    document.querySelector('.meta').textContent = result.entry.data.excerpt ?? ''
    document.body.dataset.seq = String(info.seq)
  },
})
</script></body>`,
  )
}

/**
 * Serves the preview with the real bridge. The CMS origin is read from the
 * page at request time (the editor), unless a test passes another one. Counts
 * page loads only, not the SDK file.
 */
async function serveBridgePreview(
  page: Page,
  options: { cmsOrigin?: string } = {},
) {
  let pages = 0
  await page.route(SITE_ROUTE, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.startsWith(SDK_DIR)) {
      const body = sdkModule(pathname)
      return body === null
        ? route.fulfill({ status: 404, body: '' })
        : route.fulfill({ contentType: 'text/javascript', body })
    }
    pages += 1
    const cmsOrigin = options.cmsOrigin ?? new URL(page.url()).origin
    return route.fulfill({
      contentType: 'text/html',
      body: bridgePage(cmsOrigin, BRIDGE_TITLE),
    })
  })
  return { count: () => pages }
}

/** The preview frame's document, for markers and reload checks. */
function previewDocument(page: Page) {
  const frame = page
    .frames()
    .find((candidate) => candidate.url().startsWith(SITE_ORIGIN))
  if (!frame) throw new Error('the preview frame has no document yet')
  return frame
}

function statusBadge(page: Page) {
  return page.getByTestId('visual-status')
}

function frameHeading(page: Page) {
  return page.frameLocator('[data-testid="visual-frame"]').locator('h1')
}

/** Opens Visual against a saved entry and waits for the bridge to go live. */
async function openLiveVisual(page: Page, title: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  const preview = await serveBridgePreview(page)
  await savedEntry(page, title)
  await openVisual(page)
  await expect(statusBadge(page)).toHaveAttribute('data-tier', 'live', {
    timeout: 15_000,
  })
  return preview
}

test('with the SDK bridge, Visual goes live and typing updates the frame without a reload', async ({
  page,
}) => {
  const preview = await openLiveVisual(page, `Live ${uniqueSuffix()}`)
  await expect(statusBadge(page)).toContainText('Live')

  // A marker on the page: a reload would clear it.
  await expect.poll(() => preview.count()).toBeGreaterThan(0)
  await previewDocument(page).evaluate(() => {
    document.body.dataset.marker = 'kept'
  })
  const pagesBefore = preview.count()

  // The title moves the slug (and so the page); the excerpt keeps the page.
  const next = `Live excerpt ${uniqueSuffix()}`
  await page.getByPlaceholder('Enter excerpt...').fill(next)
  const meta = page
    .frameLocator('[data-testid="visual-frame"]')
    .locator('.meta')
  await expect(meta).toHaveText(next, { timeout: 5_000 })

  // Autosave runs after the live update; the frame must not reload for it.
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-dirty',
    'false',
    { timeout: 30_000 },
  )
  // A save-triggered reload would land within ~1 s of the save.
  await page.waitForTimeout(1500)
  expect(preview.count()).toBe(pagesBefore)
  expect(
    await previewDocument(page).evaluate(() => document.body.dataset.marker),
  ).toBe('kept')
  await expect(meta).toHaveText(next)
})

test('fast typing ends on the final title and sends far fewer requests than keystrokes', async ({
  page,
}) => {
  await openLiveVisual(page, `Fast ${uniqueSuffix()}`)

  let posts = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/api/editor/live-preview')
    ) {
      posts += 1
    }
  })

  const text = 'abcdefghijklmnopqrstuvwxyz0123' // 30 keystrokes
  await titleInput(page).fill('')
  await titleInput(page).pressSequentially(text, { delay: 20 })

  await expect(frameHeading(page)).toHaveText(text, { timeout: 5_000 })
  expect(posts).toBeGreaterThan(0)
  expect(posts).toBeLessThanOrEqual(10)
})

test('without the bridge the status is on-save, and autosave reloads the frame', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const preview = await servePreview(page)
  await savedEntry(page, `No bridge ${uniqueSuffix()}`)
  await openVisual(page)

  await expect(statusBadge(page)).toHaveAttribute('data-tier', 'on-save', {
    timeout: 10_000,
  })
  await expect(statusBadge(page)).toContainText('Updates on save')

  const before = preview.count()
  await titleInput(page).fill(`No bridge renamed ${uniqueSuffix()}`)
  await expect
    .poll(() => preview.count(), { timeout: 30_000 })
    .toBeGreaterThan(before)
})

test('a bridge configured for another origin never goes live', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const preview = await serveBridgePreview(page, {
    cmsOrigin: 'https://evil.example',
  })
  await savedEntry(page, `Wrong origin ${uniqueSuffix()}`)
  await openVisual(page)

  await expect(statusBadge(page)).toHaveAttribute('data-tier', 'on-save', {
    timeout: 10_000,
  })

  // Typing does not reach the frame: autosave reloads it, and the page keeps its
  // own (fixture) title, not the typed one.
  const before = preview.count()
  const typed = `Not live ${uniqueSuffix()}`
  await titleInput(page).fill(typed)
  await expect
    .poll(() => preview.count(), { timeout: 30_000 })
    .toBeGreaterThan(before)
  await expect(frameHeading(page)).toHaveText(BRIDGE_TITLE)
  await expect(statusBadge(page)).toHaveAttribute('data-tier', 'on-save')
})

test('a failing live endpoint shows Retrying and recovers when it works again', async ({
  page,
}) => {
  await openLiveVisual(page, `Failing ${uniqueSuffix()}`)

  await page.route(LIVE_ENDPOINT, (route) =>
    route.fulfill({ status: 500, body: 'error' }),
  )
  await titleInput(page).fill(`Failing ${uniqueSuffix()}`)
  await expect(statusBadge(page)).toHaveAttribute('data-error', 'true', {
    timeout: 10_000,
  })
  await expect(statusBadge(page)).toContainText('Retrying')
  await expect(statusBadge(page)).toHaveAttribute('data-tier', 'live')

  await page.unroute(LIVE_ENDPOINT)
  const recovered = `Recovered ${uniqueSuffix()}`
  await titleInput(page).fill(recovered)
  await expect(statusBadge(page)).toHaveAttribute('data-error', 'false', {
    timeout: 10_000,
  })
  await expect(statusBadge(page)).toContainText('Live')
  await expect(frameHeading(page)).toHaveText(recovered, { timeout: 5_000 })
})

// ---------------------------------------------------------------------------
// Tier 3: click to edit (docs/design/visual-editor.md, Decisions 12-17).

/**
 * The bridge fixture with field markers: the page's own title, excerpt and
 * SEO summary, an element owned by another entry, and one whose owner does
 * not exist (it must behave as unmarked).
 */
function markedPage(cmsOrigin: string, ownerEntryId: string | null) {
  return bridgePage(cmsOrigin, BRIDGE_TITLE)
    .replace('<h1>', '<h1 data-areca-field="title">')
    .replace(
      '<div class="meta">',
      '<div class="meta" data-areca-field="excerpt">',
    )
    .replace(
      '</main>',
      `<p class="summary" data-areca-field="$seo.summary">In short: a season of tasting.</p>
<aside style="margin-top:48px;font-family:system-ui">
${ownerEntryId ? `<div class="owner" data-areca-field="title" data-areca-entry="${ownerEntryId}">Read next: the owner article</div>` : ''}
<div class="ghost" data-areca-field="name" data-areca-entry="does-not-exist">A card for an entry that is gone</div>
</aside></main>`,
    )
}

/** Serves the marked fixture for every page (other pages too, for Browse). */
async function serveMarkedPreview(page: Page, owner: { id: string | null }) {
  await page.route(SITE_ROUTE, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.startsWith(SDK_DIR)) {
      const body = sdkModule(pathname)
      return body === null
        ? route.fulfill({ status: 404, body: '' })
        : route.fulfill({ contentType: 'text/javascript', body })
    }
    // A page of the site without the bridge (a public page).
    if (pathname === '/plain') {
      return route.fulfill({
        contentType: 'text/html',
        body: FIXTURE.replace('__TITLE__', 'A public page'),
      })
    }
    return route.fulfill({
      contentType: 'text/html',
      body: markedPage(new URL(page.url()).origin, owner.id),
    })
  })
}

function previewFrame(page: Page) {
  return page.frameLocator('[data-testid="visual-frame"]')
}

/** The field key of the element focused in the editor. */
function focusedField(page: Page) {
  return page.evaluate(
    () =>
      document.activeElement
        ?.closest('[data-field]')
        ?.getAttribute('data-field') ?? null,
  )
}

/** Number of boxes of a kind the bridge draws in its shadow root. */
function overlayBoxes(page: Page, kind: 'hover' | 'highlight' | 'area') {
  return previewDocument(page).evaluate((name) => {
    const root = document.querySelector(
      '[data-areca-visual="overlay"]',
    )?.shadowRoot
    if (!root) return 0
    return [...root.querySelectorAll(`.box.${name}`)].filter(
      (box) => (box as HTMLElement).style.display !== 'none',
    ).length
  }, kind)
}

async function openClickableVisual(
  page: Page,
  owner = { id: null as string | null },
) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveMarkedPreview(page, owner)
  await savedEntry(page, `Clickable ${uniqueSuffix()}`)
  await openVisual(page)
  await expect(statusBadge(page)).toHaveAttribute('data-tier', 'live', {
    timeout: 15_000,
  })
  await expect(statusBadge(page)).toHaveAttribute('data-clickable', 'true', {
    timeout: 10_000,
  })
}

test('click to edit: hover outlines a field, a click focuses and pulses it', async ({
  page,
}) => {
  await openClickableVisual(page)
  await expect(page.getByTestId('visual-select-mode')).toBeVisible()

  await previewFrame(page).locator('h1').hover()
  await expect.poll(() => overlayBoxes(page, 'hover')).toBe(1)

  // Move focus away first, so the click is what focuses the title.
  await page.getByPlaceholder('Enter excerpt...').focus()
  await previewFrame(page).locator('h1').click()
  await expect.poll(() => focusedField(page)).toBe('title')
  await expect(page.locator('[data-field="title"][data-pulse]')).toHaveCount(1)
})

test('click to edit: focusing a field in the editor outlines it in the preview', async ({
  page,
}) => {
  await openClickableVisual(page)
  await page.getByPlaceholder('Enter excerpt...').focus()
  await expect.poll(() => overlayBoxes(page, 'highlight')).toBe(1)
  // A field the page does not show clears the outline.
  await titleInput(page).focus()
  await expect.poll(() => overlayBoxes(page, 'highlight')).toBe(1)
  await page.locator('[data-field="slug"] input').focus()
  await expect.poll(() => overlayBoxes(page, 'highlight')).toBe(0)
})

test('click to edit: an SEO marker opens its collapsed group and focuses the field', async ({
  page,
}) => {
  await openClickableVisual(page)
  await expect(page.locator('[data-field="$seo.summary"]')).toHaveCount(0)
  await previewFrame(page).locator('.summary').click()
  await expect.poll(() => focusedField(page)).toBe('$seo.summary')
})

test('Select only takes over marked elements; other links navigate and the away bar returns', async ({
  page,
}) => {
  await openClickableVisual(page)
  const link = previewFrame(page).locator('nav a').nth(1)

  // A marked element is selected, not followed.
  await previewFrame(page).locator('h1').first().click()
  await page.waitForTimeout(500)
  await expect(page.getByTestId('visual-away')).toBeHidden()

  // An unmarked link works as on the site, even in Select.
  await link.click()
  await expect(page.getByTestId('visual-away')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('visual-away-back').click()
  await expect(page.getByTestId('visual-away')).toBeHidden({ timeout: 10_000 })
})

test('a click in full screen exits, focuses the field and offers Back to full preview', async ({
  page,
}) => {
  await openClickableVisual(page)
  const root = page.getByTestId('visual-preview')
  await page.getByTestId('visual-fullscreen').click()
  await expect(root).toHaveAttribute('data-fullscreen', 'true')

  await previewFrame(page).locator('h1').click()
  await expect(root).toHaveAttribute('data-fullscreen', 'false')
  await expect.poll(() => focusedField(page)).toBe('title')

  const back = page.getByTestId('visual-back-fullscreen')
  await expect(back).toBeVisible()
  await back.click()
  await expect(root).toHaveAttribute('data-fullscreen', 'true')
  await page.keyboard.press('Escape')
  await expect(root).toHaveAttribute('data-fullscreen', 'false')
  await expect(back).toBeHidden()
})

test('another entry on the page opens a popover; unknown owners stay unmarked; Open goes there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const owner = { id: null as string | null }
  await serveMarkedPreview(page, owner)
  const ownerTitle = `Owner ${uniqueSuffix()}`
  const ownerUrl = await savedEntry(page, ownerTitle)
  owner.id = new URL(ownerUrl).pathname.split('/').pop() ?? null
  await backToCollection(page)
  await createArticle(page, `Referrer ${uniqueSuffix()}`)
  await openVisual(page)
  await expect(statusBadge(page)).toHaveAttribute('data-clickable', 'true', {
    timeout: 15_000,
  })

  // The missing entry is not a target: no popover, no field.
  await previewFrame(page).locator('.ghost').click()
  await page.waitForTimeout(400)
  await expect(page.getByTestId('visual-owner-popover')).toBeHidden()

  await previewFrame(page).locator('.owner').click()
  const popover = page.getByTestId('visual-owner-popover')
  await expect(popover).toBeVisible({ timeout: 10_000 })
  await expect(popover).toContainText(`Articles › ${ownerTitle}`)
  await page.getByTestId('visual-owner-open').click()
  await expect(page).toHaveURL(new RegExp(`/${owner.id}\\?view=visual`))
  await expect(titleInput(page)).toHaveValue(ownerTitle)
})

test('Show editable areas outlines every target and is remembered', async ({
  page,
}) => {
  await openClickableVisual(page)
  const toggle = page.getByTestId('visual-show-areas')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // Title, excerpt and SEO summary (the ghost owner is not a target).
  await expect.poll(() => overlayBoxes(page, 'area')).toBe(3)

  await page.reload()
  await expect(page.getByTestId('visual-show-areas')).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 20_000 },
  )
  await page.getByTestId('visual-show-areas').click()
})

test('a full page load to a page without the bridge shows the away bar', async ({
  page,
}) => {
  await openClickableVisual(page)
  // A plain link or language switcher: a full load, and no bridge answers.
  await previewDocument(page).evaluate(() => {
    window.location.href = '/plain'
  })
  await expect(page.getByTestId('visual-away')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('visual-away-back').click()
  await expect(page.getByTestId('visual-away')).toBeHidden({ timeout: 15_000 })
  await expect(statusBadge(page)).toHaveAttribute('data-clickable', 'true', {
    timeout: 15_000,
  })
})

test('Esc pressed inside the preview exits full screen', async ({ page }) => {
  await openClickableVisual(page)
  await page.getByTestId('visual-fullscreen').click()
  await expect(page.getByTestId('visual-preview')).toHaveAttribute(
    'data-fullscreen',
    'true',
  )
  // An unmarked part of the page: focus moves into the frame, nothing opens.
  await previewFrame(page).locator('.ghost').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('visual-preview')).toHaveAttribute(
    'data-fullscreen',
    'false',
  )
})
