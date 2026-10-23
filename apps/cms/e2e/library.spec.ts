import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ACME_SITE,
  EDITOR,
  OWNER,
  TINY_PNG,
  expectDisabledWithReason,
  expectToast,
  hydrated,
  login,
  openSite,
  uniqueSuffix,
} from './helpers'

async function openLibrary(page: Page) {
  await page.getByTestId('sidebar').getByTestId('library-nav').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library-page')).toBeVisible()
  await hydrated(page, page.getByTestId('library-page'))
}

async function upload(page: Page, name: string) {
  await page
    .getByTestId('library-page')
    .getByTestId('media-upload')
    .setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })
  const tile = page.getByTestId(`media-card-${name}`)
  await expect(tile).toBeVisible()
  return tile
}

test('owner uploads to the Library, describes a file and deletes it', async ({
  page,
}) => {
  const name = `library-${uniqueSuffix()}.png`

  await login(page, OWNER)
  await openSite(page, ACME_SITE)
  await openLibrary(page)
  await expect(page.getByTestId('library-page')).toContainText('Shared by all')

  const tile = await upload(page, name)
  // No description yet: a small amber dot.
  await expect(tile.getByTestId('media-missing-alt')).toBeVisible()

  // Search narrows the grid.
  await page.getByTestId('library-search').fill(name)
  await expect(page.locator('[data-testid^="media-card-"]')).toHaveCount(1)

  // The detail slide-over: preview, description (saved on Enter), info.
  await tile.click()
  const drawer = page.getByTestId('asset-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(name)
  await expect(page.getByTestId('asset-info')).toContainText('image/png')
  await expect(page.getByTestId('asset-info')).toContainText('Acme Owner')
  const description = page.getByLabel('Description (alt text)')
  await description.fill('A single transparent pixel')
  await description.press('Enter')
  await expect(page.getByTestId('asset-alt-status')).toContainText('Saved')
  await expect(page.getByTestId('asset-copy-link')).toBeVisible()
  await expect(page.getByTestId('asset-open')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(tile.getByTestId('media-missing-alt')).toHaveCount(0)

  // The description persists.
  await page.reload()
  await expect(page.getByTestId('library-page')).toBeVisible()
  await hydrated(page)
  await page.getByTestId('library-search').fill(name)
  await page.getByTestId(`media-card-${name}`).click()
  await expect(page.getByLabel('Description (alt text)')).toHaveValue(
    'A single transparent pixel',
  )

  // Owners can delete (with a confirm).
  const remove = page.getByTestId('asset-delete')
  await expect(remove).toBeEnabled()
  await remove.click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Delete this file?')
  await page.getByTestId('confirm-action').click()
  await expectToast(page, 'Deleted')
  await expect(page.getByTestId(`media-card-${name}`)).toHaveCount(0)
})

test('editors can upload but see Delete disabled with the reason', async ({
  page,
}) => {
  const name = `editor-${uniqueSuffix()}.png`
  await login(page, EDITOR)
  await openSite(page, ACME_SITE)
  await openLibrary(page)
  const tile = await upload(page, name)
  await tile.click()
  await expect(page.getByTestId('asset-drawer')).toBeVisible()
  await expectDisabledWithReason(
    page,
    page.getByTestId('asset-delete'),
    'Only owners can delete files from the Library.',
  )
})
