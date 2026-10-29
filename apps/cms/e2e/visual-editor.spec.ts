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
