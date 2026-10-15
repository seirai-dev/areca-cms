import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ADMIN,
  createIsolatedAcmeSite,
  hydrated,
  login,
  openCollection,
  openSite,
  siteIdFromUrl,
  uniqueSuffix,
} from './helpers'

/**
 * Settings › Languages for the current site, once the tab has loaded. Settings
 * and the schema editor are for agency admins, so these specs sign in as one.
 */
async function openLanguagesTab(page: Page) {
  await page.goto(`/sites/${siteIdFromUrl(page)}/settings?tab=languages`)
  await hydrated(page, page.getByTestId('settings-languages'))
}

/**
 * Turns a single-language site into an English (main) + Dutch site. The
 * empty-state picker is pinned to English so the main language is known.
 */
async function setUpEnglishDutch(page: Page) {
  await openLanguagesTab(page)
  await expect(page.getByTestId('languages-empty')).toBeVisible()
  await page.getByTestId('languages-main-picker').click()
  // The option reads "English en": the name, then the tag.
  await page.getByRole('option', { name: /^English\s+en$/ }).click()
  await page.getByTestId('add-languages').click()
  await page.getByTestId('add-language').click()
  await page.getByTestId('language-search').fill('nl')
  await page.getByTestId('language-option-nl').click()
  await page.getByTestId('save-languages').click()
  await expect(page.getByTestId('language-row-nl')).toBeVisible()
  await expect(page.getByTestId('language-main-en')).toBeChecked()
}

test('languages: set up, change main with a confirm, remove with type-to-confirm', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createIsolatedAcmeSite(page, `lang-${suffix}`)
  await login(page, ADMIN)
  await openSite(page, siteSlug)
  await setUpEnglishDutch(page)

  // A third language, American English.
  await page.getByTestId('add-language').click()
  await page.getByTestId('language-search').fill('en-US')
  await page.getByTestId('language-option-en-US').click()
  await page.getByTestId('save-languages').click()
  await expect(page.getByTestId('language-row-en-US')).toBeVisible()

  // Changing main asks first, with the gap count in the dialog.
  await page.getByTestId('language-main-nl').click()
  const dialog = page.getByRole('alertdialog')
  // Dialogs name languages in the CMS language, not the endonym.
  await expect(dialog).toContainText('Make Dutch the main language?')
  await dialog.getByRole('button', { name: 'Change main language' }).click()
  await page.getByTestId('save-languages').click()
  await expect(page.getByTestId('language-main-nl')).toBeChecked()

  // The main language cannot be removed; another one needs its name typed.
  await expect(page.getByTestId('language-remove-nl')).toBeDisabled()
  const englishName =
    (await page.getByTestId('language-name-en-US').textContent())?.trim() ?? ''
  await page.getByTestId('language-remove-en-US').click()
  const removeDialog = page.getByTestId('remove-language-dialog')
  const confirm = removeDialog.getByTestId('confirm-action')
  await expect(confirm).toBeDisabled()
  await removeDialog.getByTestId('confirm-text').fill(englishName)
  await confirm.click()
  await page.getByTestId('save-languages').click()
  await expect(page.getByTestId('language-row-en-US')).toHaveCount(0)
})

test('languages: the schema editor shows translatable and required-language controls', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createIsolatedAcmeSite(
    page,
    `lang-schema-${suffix}`,
  )
  await login(page, ADMIN)
  await openSite(page, siteSlug)
  await setUpEnglishDutch(page)

  await openCollection(page, 'articles')
  await page.getByTestId('collection-menu').click()
  await page.getByTestId('edit-structure').click()

  // Fields: the title row offers the Translatable switch.
  await page.getByTestId('field-label-1').click()
  await expect(page.getByTestId('field-translatable-1')).toBeVisible()
  await page.getByTestId('field-back').click()

  // Settings: the main language is locked on, Dutch is a toggle.
  await page.getByTestId('schema-tab-settings').click()
  await expect(page.getByTestId('required-language-en')).toHaveAttribute(
    'data-locked',
    'true',
  )
  await expect(page.getByTestId('required-language-nl')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByTestId('required-language-nl').click()
  await expect(page.getByTestId('required-language-nl')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('languages: the entry list offers the missing-translation filter', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createIsolatedAcmeSite(page, `lang-list-${suffix}`)
  await login(page, ADMIN)
  await openSite(page, siteSlug)
  await setUpEnglishDutch(page)

  await openCollection(page, 'articles')
  const filter = page.getByTestId('missing-language-filter')
  await expect(filter).toBeVisible()
  await filter.click()
  await expect(page.getByTestId('missing-language-any')).toBeVisible()
  await page.getByTestId('missing-language-nl').click()
  await expect(page).toHaveURL(/missing=nl/)
})
