import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  OWNER,
  backToCollection,
  createIsolatedAcmeSite,
  entryIdFromUrl,
  hydrated,
  login,
  markAsReady,
  openCollection,
  openSite,
  richText,
  siteIdFromUrl,
  slugify,
  startNewEntry,
  titleInput,
  uniqueSuffix,
  waitForSaved,
  writeArticle,
} from './helpers'

/**
 * The rich text link field (docs/design/rich-text-links.md, decisions 12 to 14).
 * The steps share one site and its two entries, so they run in order.
 */
test.describe.configure({ mode: 'serial' })

const suffix = uniqueSuffix()
const targetTitle = `E2E Ethiopia ${suffix}`
const sourceTitle = `E2E Source ${suffix}`
let siteSlug = ''
let siteId = ''
let targetId = ''
let sourceId = ''
/** The path of the target in the stored link (set once the link is saved). */
let targetPath = ''

/**
 * Adds a paragraph with `text` after the plain paragraph "More text" and selects
 * exactly that text. Enter starts the new paragraph from a plain one: pressing it
 * at the end of a linked paragraph joins the text to the link (the duplicate
 * prosemirror-model copies in the lockfile; see the report of this change).
 */
async function newSelectedParagraph(page: Page, text: string) {
  const editor = richText(page)
  await editor.locator('p', { hasText: /^More text$/ }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await page.keyboard.down('Shift')
  for (const _character of text) {
    await page.keyboard.press('ArrowLeft')
  }
  await page.keyboard.up('Shift')
}

/** Opens the link field for the selection and returns its input. */
async function openLinkField(page: Page) {
  await page.getByTestId('rich-text-link').click()
  const input = page.locator('#rich-text-link-url')
  await expect(input).toBeVisible()
  return input
}

async function openEntry(page: Page, id: string) {
  await page.goto(`/sites/${siteId}/c/articles/${id}`)
  await hydrated(page, titleInput(page))
  await expect(richText(page)).toBeVisible()
}

test('creates a target page with a section and a source page', async ({
  page,
}) => {
  test.setTimeout(420_000)
  siteSlug = (await createIsolatedAcmeSite(page, `lp-${suffix}`)).siteSlug

  await login(page, OWNER)
  await openSite(page, siteSlug)
  siteId = siteIdFromUrl(page)
  await openCollection(page, 'articles')

  // The target: a section ("Origin") and a paragraph, then Ready.
  await startNewEntry(page)
  await titleInput(page).fill(targetTitle)
  await richText(page).click()
  await page.keyboard.type('Coffee from the highlands')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## Origin')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Beans from the highlands')
  await waitForSaved(page)
  targetId = entryIdFromUrl(page)
  await markAsReady(page)

  // The source: a section of its own, for the `#` list.
  await backToCollection(page)
  await startNewEntry(page)
  await writeArticle(page, sourceTitle, 'Start here')
  await waitForSaved(page)
  sourceId = entryIdFromUrl(page)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## Opening notes')
  await page.keyboard.press('Enter')
  await page.keyboard.type('More text')
  await waitForSaved(page)
})

test('a typed web address offers only the custom link; Enter makes it an https link', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page, OWNER)
  await openEntry(page, sourceId)

  await newSelectedParagraph(page, 'Visit the shop')
  const input = await openLinkField(page)
  await input.fill('goo')
  await expect(page.getByTestId('link-suggestion-custom')).toHaveText(
    'Custom link: https://goo',
  )
  await expect(
    page.locator('[data-testid^="link-suggestion-entry-"]'),
  ).toHaveCount(0)

  await input.fill('coffee beans')
  await expect(page.getByTestId('link-suggestion-hint')).toContainText(
    'Not a link yet. Pick a page, or type a web address',
  )
  await expect(page.getByTestId('link-suggestion-custom')).toHaveCount(0)

  await input.fill('google.com')
  await expect(page.getByTestId('link-suggestion-custom')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await input.press('Enter')
  await expect(input).toBeHidden()

  const link = richText(page).locator('a', { hasText: 'Visit the shop' })
  await expect(link).toHaveCount(1)
  await waitForSaved(page)
  await page.reload()
  await hydrated(page, titleInput(page))
  const stored = richText(page).locator('a', { hasText: 'Visit the shop' })
  await expect(stored).toHaveAttribute('href', 'https://google.com')
  await expect(stored).toHaveAttribute('target', '_blank')
  await expect(stored).not.toHaveAttribute('data-entry-id', /.+/)
})

test('part of a title finds the page with its status; Enter links to the entry, and the section sets an anchor', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await login(page, OWNER)
  await openEntry(page, sourceId)

  await newSelectedParagraph(page, 'Read about ethiopia')
  const input = await openLinkField(page)
  await input.fill('ethiopia')
  const row = page.getByTestId(`link-suggestion-entry-${targetId}`)
  await expect(row).toBeVisible()
  await expect(row).toContainText(targetTitle)
  await expect(row).toContainText('Ready')
  await expect(row).toHaveAttribute('aria-selected', 'true')
  // Plain words that match an entry offer no custom link.
  await expect(page.getByTestId('link-suggestion-custom')).toHaveCount(0)

  await input.press('Enter')
  await expect(page.getByTestId('link-chip')).toContainText(targetTitle)
  // Picked: the field collapses to the chip, the section and Remove/Done.
  await expect(input).toBeHidden()
  await expect(page.getByTestId('link-suggestions')).toBeHidden()
  const section = page.getByTestId('link-section-select')
  // Picked: the keyboard goes to the section, the next thing to fill in.
  await expect(section).toBeFocused()
  await expect(section.locator('option', { hasText: 'Origin' })).toHaveCount(1)
  await section.selectOption({ label: 'Origin' })
  await page.getByTestId('rich-text-link-done').click()
  await expect(input).toBeHidden()

  await waitForSaved(page)
  await page.reload()
  await hydrated(page, titleInput(page))
  const stored = richText(page).locator('a', { hasText: 'Read about ethiopia' })
  await expect(stored).toHaveAttribute('data-entry-id', targetId)
  await expect(stored).toHaveAttribute('data-anchor', 'origin')
  await expect(stored).not.toHaveAttribute('target', '_blank')
  const href = (await stored.getAttribute('href')) ?? ''
  expect(href).toMatch(/^\/blog\/e2e-ethiopia-.+#origin$/)
  targetPath = href.replace(/#origin$/, '')
})

test('typing a page path finds the page and selects it', async ({ page }) => {
  test.setTimeout(240_000)
  expect(targetPath).toMatch(/^\/blog\//)
  await login(page, OWNER)
  await openEntry(page, sourceId)

  await newSelectedParagraph(page, 'Path check')
  const input = await openLinkField(page)
  await input.fill(targetPath)
  const row = page.getByTestId(`link-suggestion-entry-${targetId}`)
  await expect(row).toContainText(`Links to ${targetTitle}`)
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await input.press('Enter')
  await expect(page.getByTestId('link-chip')).toContainText(targetTitle)
  await page.getByTestId('rich-text-link-done').click()

  await waitForSaved(page)
  await page.reload()
  await hydrated(page, titleInput(page))
  const stored = richText(page).locator('a', { hasText: 'Path check' })
  await expect(stored).toHaveAttribute('data-entry-id', targetId)
  await expect(stored).not.toHaveAttribute('data-anchor', /.+/)
})

test('# lists the sections of this page; picking one links to it', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page, OWNER)
  await openEntry(page, sourceId)

  await newSelectedParagraph(page, 'Jump to notes')
  const input = await openLinkField(page)
  await input.fill('#')
  await expect(
    page.getByTestId('link-suggestion-heading-opening-notes'),
  ).toBeVisible()
  await input.press('Enter')
  await expect(input).toBeHidden()

  await waitForSaved(page)
  await page.reload()
  await hydrated(page, titleInput(page))
  const stored = richText(page).locator('a', { hasText: 'Jump to notes' })
  await expect(stored).toHaveAttribute('href', '#opening-notes')
  await expect(stored).not.toHaveAttribute('data-entry-id', /.+/)
  await expect(stored).not.toHaveAttribute('target', '_blank')
})

test('an empty field lists the recent pages; an existing link opens as a chip', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page, OWNER)
  await openEntry(page, sourceId)

  await newSelectedParagraph(page, 'Recent check')
  await openLinkField(page)
  await expect(
    page.getByTestId(`link-suggestion-entry-${targetId}`),
  ).toBeVisible()
  await expect(
    page.getByTestId(`link-suggestion-entry-${sourceId}`),
  ).toBeVisible()
  await expect(page.getByTestId('link-suggestion-custom')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('#rich-text-link-url')).toBeHidden()

  // Put the cursor in the existing entry link: the field shows it as a chip.
  await richText(page).locator('a', { hasText: 'Read about ethiopia' }).click()
  await page.getByTestId('rich-text-link').click()
  await expect(page.getByTestId('link-chip')).toContainText(targetTitle)
  await expect(page.getByTestId('link-section-select')).toHaveValue('origin')
  await expect(page.locator('#rich-text-link-url')).toBeHidden()
  // An existing link opens as a chip: Change has the focus, not the field.
  await expect(page.getByTestId('link-change')).toBeFocused()

  // Change reopens the search, with the field focused.
  await page.getByTestId('link-change').click()
  await expect(page.locator('#rich-text-link-url')).toBeFocused()
  await expect(page.getByTestId('link-chip')).toBeHidden()
  await page.keyboard.press('Escape')
})

/** The id a client uses to call a server function, read from its module (as the stubs do). */
async function serverFnId(page: Page, file: string, name: string) {
  const source = await (await page.request.get(file)).text()
  for (const match of source.matchAll(/createClientRpc\("([^"]+)"\)/g)) {
    const decoded = JSON.parse(
      Buffer.from(match[1], 'base64url').toString(),
    ) as { export: string }
    if (decoded.export.split('_createServerFn')[0] === name) return match[1]
  }
  throw new Error(`no server function ${name} in ${file}`)
}

test('a failed search says so and lists no pages; a typed address still links; Retry loads the pages', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await login(page, OWNER)
  await openEntry(page, sourceId)

  // Only this test's searches fail: the server function answers with an error.
  const search = await serverFnId(
    page,
    '/src/server/fn/link-targets.ts',
    'searchLinkTargetsFn',
  )
  await page.route(`**/_serverFn/${search}**`, (route) =>
    route.fulfill({ status: 500, contentType: 'text/plain', body: 'failed' }),
  )

  await newSelectedParagraph(page, 'Failed search')
  const input = await openLinkField(page)
  await input.fill('ethiopia')
  // The client retries before it gives up, so the message takes a moment.
  const failed = page.getByTestId('link-search-error')
  await expect(failed).toContainText('Could not load pages', {
    timeout: 30_000,
  })
  await expect(
    page.locator('[data-testid^="link-suggestion-entry-"]'),
  ).toHaveCount(0)
  await expect(page.getByTestId('link-suggestion-custom')).toHaveCount(0)

  // An address is still a link: its custom row is there and can be chosen.
  await input.fill('https://example.com/failed-search')
  const custom = page.getByTestId('link-suggestion-custom')
  await expect(custom).toBeVisible()
  await expect(custom).not.toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('link-search-error')).toBeHidden()
  await input.fill('ethiopia')
  await expect(page.getByTestId('link-search-error')).toBeVisible({
    timeout: 30_000,
  })

  // Retry asks again; once the server answers, the pages are listed.
  await page.unroute(`**/_serverFn/${search}**`)
  await page.getByTestId('link-search-retry').click()
  await expect(
    page.getByTestId(`link-suggestion-entry-${targetId}`),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('link-search-error')).toBeHidden()
  await page.keyboard.press('Escape')
})

test('a link to an archived page is marked as dead, with a tooltip', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await page.getByTestId('select-mode').click()
  await page
    .getByRole('button', { name: `Select ${targetTitle}`, exact: true })
    .click()
  const bar = page.getByTestId('bulk-actions')
  await expect(bar).toContainText('1 selected')
  await bar.getByTestId('bulk-archive').click()
  await expect(
    page
      .getByTestId(`entry-${slugify(targetTitle)}`)
      .getByTestId('entry-status'),
  ).toHaveAttribute('data-ui-status', 'archived')

  await openEntry(page, sourceId)
  // The mark is a decoration on the text inside the link, so the class sits on a span.
  const dead = richText(page).locator('.rich-text-link-dead', {
    hasText: 'Read about ethiopia',
  })
  await expect(dead).toHaveAttribute('title', 'This page no longer exists')
  await expect(dead).toHaveAttribute('data-dead-link', 'gone')
  // The stored link is unchanged: the mark is a decoration only.
  await expect(
    richText(page).locator('a', { hasText: 'Read about ethiopia' }),
  ).toHaveAttribute('data-entry-id', targetId)
})
