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
  startNewEntry,
  titleInput,
  uniqueSuffix,
  waitForSaved,
  writeArticle,
} from './helpers'

/**
 * Renaming a heading that links point to (docs/design/rich-text-links.md,
 * decisions 20 and 21). The steps share one site and its two entries, so they
 * run in order.
 */
test.describe.configure({ mode: 'serial' })

const suffix = uniqueSuffix()
const targetTitle = `E2E Origin ${suffix}`
const sourceTitle = `E2E Linking ${suffix}`
const sourceText = 'Read the origin story'
let siteSlug = ''
let siteId = ''
let targetId = ''
let sourceId = ''

async function openEntry(page: Page, id: string) {
  await page.goto(`/sites/${siteId}/c/articles/${id}`)
  await hydrated(page, titleInput(page))
  await expect(richText(page)).toBeVisible()
}

test('creates a target with an Origin section, marked ready', async ({
  page,
}) => {
  test.setTimeout(420_000)
  siteSlug = (await createIsolatedAcmeSite(page, `sl-${suffix}`)).siteSlug

  await login(page, OWNER)
  await openSite(page, siteSlug)
  siteId = siteIdFromUrl(page)
  await openCollection(page, 'articles')

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
})

test('a source links to the Origin section and is marked ready', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await startNewEntry(page)
  await writeArticle(page, sourceTitle, 'Start here')
  await waitForSaved(page)
  sourceId = entryIdFromUrl(page)

  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(sourceText)
  await page.keyboard.down('Shift')
  for (const _character of sourceText) {
    await page.keyboard.press('ArrowLeft')
  }
  await page.keyboard.up('Shift')
  await page.getByTestId('rich-text-link').click()
  const input = page.locator('#rich-text-link-url')
  await expect(input).toBeVisible()
  await input.fill(targetTitle)
  await expect(
    page.getByTestId(`link-suggestion-entry-${targetId}`),
  ).toBeVisible()
  await input.press('Enter')
  await expect(page.getByTestId('link-chip')).toContainText(targetTitle)
  const section = page.getByTestId('link-section-select')
  await expect(section).toBeFocused()
  await section.selectOption({ label: 'Origin' })
  await page.getByTestId('rich-text-link-done').click()
  await expect(input).toBeHidden()
  await waitForSaved(page)
  await markAsReady(page)

  await page.reload()
  await hydrated(page, titleInput(page))
  const link = richText(page).locator('a', { hasText: sourceText })
  await expect(link).toHaveAttribute('data-entry-id', targetId)
  await expect(link).toHaveAttribute('data-anchor', 'origin')
  await backToCollection(page)
})

test('renaming the heading offers the links; Update all links moves them and the source stays Ready', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await login(page, OWNER)
  await openEntry(page, targetId)

  const heading = richText(page).locator('h2', { hasText: 'Origin' })
  await heading.click()
  await page.keyboard.press('End')
  // Delete the old text one character at a time, then type the new text. A
  // selection replaced in one go turns the heading into a paragraph.
  for (const _character of 'Origin') {
    await page.keyboard.press('Backspace')
  }
  await page.keyboard.type('Where it grows')
  await expect(
    richText(page).locator('h2', { hasText: 'Where it grows' }),
  ).toBeVisible()
  // An explicit save (⌘S), so the editor compares the headings it saved last.
  await page.keyboard.press('ControlOrMeta+s')

  const dialog = page.getByTestId('section-link-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("1 link points to the section 'Origin'.")
  await expect(dialog.getByTestId('section-link-linker')).toContainText(
    sourceTitle,
  )
  await expect(dialog.getByTestId('section-link-linker')).toContainText('Ready')

  await dialog.getByTestId('section-link-update-all').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Links updated.')).toBeVisible()

  await openEntry(page, sourceId)
  const link = richText(page).locator('a', { hasText: sourceText })
  await expect(link).toHaveAttribute('data-anchor', 'where-it-grows')
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'ready',
  )
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'published',
  )
})

test('Linked from on the target lists the source and the section it links to', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await login(page, OWNER)
  await openEntry(page, targetId)

  const panel = page.getByTestId('entry-details')
  const linkedFrom = panel.getByTestId('details-linked-from')
  await expect(linkedFrom).toBeVisible()
  const source = linkedFrom.getByTestId('linked-from-source')
  await expect(source).toContainText(sourceTitle)
  await expect(source).toContainText('Where it grows')
  await expect(source).toContainText('Ready')
  await source.getByRole('link', { name: sourceTitle }).click()
  await expect(page).toHaveURL(new RegExp(`/c/articles/${sourceId}$`))
})
