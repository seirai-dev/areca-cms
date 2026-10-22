import { expect, test } from '@playwright/test'

import {
  ACME_SITE,
  OWNER,
  backToCollection,
  createArticle,
  login,
  openCollection,
  openSite,
  uniqueSuffix,
} from './helpers'

test('command palette finds entries and pages; keyboard shortcuts navigate', async ({
  page,
}) => {
  const title = `Palette ${uniqueSuffix()}`
  await login(page, OWNER)
  const siteId = await openSite(page, ACME_SITE)
  await openCollection(page, 'articles')
  const entryId = await createArticle(page, title)
  await backToCollection(page)

  /* ⌘K / Ctrl+K opens the palette; entries are searched on the server. */
  const input = page.getByTestId('command-input')
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(input).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expect(input).toBeFocused()
  const list = page.getByTestId('command-palette')
  await expect(list.getByText('Go to', { exact: true })).toBeVisible()
  await expect(list.getByText('Actions', { exact: true })).toBeVisible()
  await input.fill(title)
  const result = list.getByRole('option').filter({ hasText: title })
  await expect(result).toBeVisible()
  await expect(list.getByText('Entries', { exact: true })).toBeVisible()
  await result.click()
  await expect(page).toHaveURL(new RegExp(`/c/articles/${entryId}$`))
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await page.getByTestId('editor-back').click()
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )

  /* The sidebar's Search field opens it too; "Go to" jumps to a page. */
  await page.getByTestId('open-search').click()
  await expect(input).toBeVisible()
  await input.fill('Library')
  await list
    .getByRole('option', { name: /Library/ })
    .first()
    .click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/library$`))
  await expect(page.getByTestId('library-page')).toBeVisible()

  /* g o → Overview, g l → Library, n → New entry (inside a collection). */
  await page.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('g')
  await page.keyboard.press('o')
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`))
  await expect(page.getByTestId('site-overview')).toBeVisible()

  await page.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('g')
  await page.keyboard.press('l')
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/library$`))

  await openCollection(page, 'articles')
  await page.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('n')
  await expect(page).toHaveURL(/\/c\/articles\/new$/)
  await expect(page.getByTestId('editor-canvas')).toBeVisible()

  // Shortcuts are listed in the account menu's dialog.
  await page.getByTestId('editor-back').click()
  await page.getByTestId('user-menu').click()
  await page.getByTestId('open-shortcuts').click()
  const dialog = page.getByTestId('shortcuts-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Library')
  await expect(dialog).toContainText('New entry')
})
