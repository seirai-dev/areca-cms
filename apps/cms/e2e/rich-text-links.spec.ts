import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  OWNER,
  createIsolatedAcmeSite,
  entryIdFromUrl,
  hydrated,
  login,
  openCollection,
  openSite,
  richText,
  startNewEntry,
  titleInput,
  uniqueSuffix,
  waitForSaved,
  writeArticle,
} from './helpers'

/**
 * Adds a new paragraph with `text`, selects exactly that text and links it
 * through the popover. The selection is made with the keyboard from the end of
 * the document, so it covers only the typed characters.
 */
async function linkNewParagraph(page: Page, text: string, url: string) {
  const editor = richText(page)
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await page.keyboard.down('Shift')
  for (const _character of text) {
    await page.keyboard.press('ArrowLeft')
  }
  await page.keyboard.up('Shift')

  await page.getByTestId('rich-text-link').click()
  const input = page.locator('#rich-text-link-url')
  await expect(input).toBeVisible()
  await input.fill(url)
  // Enter takes the selected row. A path waits for its answer first, so wait
  // until the custom link is selected (docs/design/rich-text-links.md, 13).
  await expect(
    page.locator('[role="option"][aria-selected="true"]'),
  ).toHaveCount(1)
  await input.press('Enter')
  await expect(input).toBeHidden()
  await expect(editor.locator('a', { hasText: text })).toHaveCount(1)
}

test('links to a page, a section and a web address keep the right href and tab', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const title = `E2E Links ${suffix}`
  const { siteSlug } = await createIsolatedAcmeSite(page, `lnk-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await startNewEntry(page)
  await writeArticle(page, title, 'Intro paragraph')
  await waitForSaved(page)
  const entryId = entryIdFromUrl(page)

  await linkNewParagraph(page, 'Read the coffees page', '/coffees')
  await linkNewParagraph(page, 'Jump to the FAQ', '#faq')
  await linkNewParagraph(page, 'example.com', 'example.com')
  await waitForSaved(page)

  /* Everything is stored; a reload shows the stored hrefs. */
  await page.reload()
  await hydrated(page, titleInput(page))
  await expect(page).toHaveURL(new RegExp(`/c/articles/${entryId}$`))
  const editor = richText(page)
  await expect(editor.locator('a')).toHaveCount(3)

  // A site path is stored as typed: not https:///coffees.
  const pageLink = editor.locator('a', { hasText: 'Read the coffees page' })
  await expect(pageLink).toHaveAttribute('href', '/coffees')
  await expect(pageLink).not.toHaveAttribute('target', '_blank')
  await expect(pageLink).not.toHaveAttribute('rel', /noopener/)

  // An in-page anchor is stored as typed and stays in the same tab.
  const anchorLink = editor.locator('a', { hasText: 'Jump to the FAQ' })
  await expect(anchorLink).toHaveAttribute('href', '#faq')
  await expect(anchorLink).not.toHaveAttribute('target', '_blank')

  // A bare domain still becomes an https link that opens in a new tab.
  const webLink = editor.locator('a', { hasText: 'example.com' })
  await expect(webLink).toHaveAttribute('href', 'https://example.com')
  await expect(webLink).toHaveAttribute('target', '_blank')
  await expect(webLink).toHaveAttribute('rel', 'noopener noreferrer')
})
