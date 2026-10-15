/**
 * Content languages in the entry editor (docs/design/content-languages.md,
 * "CMS UI"). The site is created with a Dutch main language and English as
 * a required language for Articles, through the manifest push.
 *
 * Test ids used:
 * - `language-bar`, `language-tab-<code>` (role=tab, aria-selected)
 * - `main-reference-<key>`, `copy-from-main-<key>` (main value under a
 *   translatable field, and its Copy action)
 * - `publish-now`, `publish-menu`, `ready-blocker` (ready gating)
 * - `entry-editor` (`data-ready`, `data-dirty`)
 * - `translate-language` (AI "Translate from <main>"), `translate-field-<key>`
 *
 * Not run against the main dev database. Runs only through
 * `pnpm test:e2e:isolated`, which uses its own database (see the script).
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ADMIN,
  OWNER,
  createSiteOnClientPage,
  hydrated,
  login,
  openClient,
  openCollection,
  openSite,
  pushManifest,
  richText,
  signOut,
  startNewEntry,
  stubAi,
  titleInput,
  uniqueSuffix,
  waitForSaved,
  writeArticle,
} from './helpers'

const MULTILINGUAL_MANIFEST = {
  languages: { main: 'nl', all: ['nl', 'en'] },
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      requiredLanguages: ['en'],
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'body', label: 'Body', type: 'richtext', required: true },
      ],
    },
  },
}

async function createMultilingualSite(page: Page, suffix: string) {
  await login(page, ADMIN)
  await openClient(page, 'Acme', 'acme')
  const site = await createSiteOnClientPage(page, suffix)
  await pushManifest(
    new URL(page.url()).origin,
    site.schemaToken,
    MULTILINGUAL_MANIFEST,
  )
  await signOut(page)
  return site
}

test('the language bar switches language, copies the main value and remembers the choice', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createMultilingualSite(page, `cl-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await startNewEntry(page)
  await writeArticle(page, `Nederlandse titel ${suffix}`, 'Nederlandse tekst')
  await waitForSaved(page)

  const bar = page.getByTestId('language-bar')
  await expect(bar).toBeVisible()
  await expect(page.getByTestId('language-tab-nl')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTestId('language-tab-en')).toHaveAttribute(
    'aria-selected',
    'false',
  )

  // Switching to English shows the Dutch title as a reference.
  await page.getByTestId('language-tab-en').click()
  await expect(page).toHaveURL(/[?&]lang=en\b/)
  await expect(page.getByTestId('main-reference-title')).toContainText(
    `Nederlandse titel ${suffix}`,
  )

  // Copy writes the main value into the English title.
  await page.getByTestId('copy-from-main-title').click()
  await expect(titleInput(page)).toHaveValue(`Nederlandse titel ${suffix}`)
  await waitForSaved(page)

  // Without ?lang the last choice for this site is restored.
  await page.goto(new URL(page.url()).pathname)
  await hydrated(page, page.getByTestId('entry-editor'))
  await expect(page.getByTestId('language-tab-en')).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('Ctrl+Shift+L switches language, and ready is blocked until English is complete', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createMultilingualSite(page, `cr-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await startNewEntry(page)
  await writeArticle(page, `Concept ${suffix}`, 'Tekst')
  await waitForSaved(page)

  // English is required and empty: ready is disabled and says why.
  const primary = page.getByTestId('publish-now')
  await expect(primary).toBeDisabled()
  await page.getByTestId('publish-menu').click()
  const blocker = page.getByTestId('ready-blocker')
  await expect(blocker).toContainText('Add English to mark ready: Title, Body')

  // The reason switches to English and focuses the first missing field.
  await blocker.click()
  await expect(page).toHaveURL(/[?&]lang=en\b/)

  // Keyboard: Ctrl+Shift+Alt+L goes back to Dutch.
  await page.keyboard.press('Control+Shift+Alt+KeyL')
  await expect(page).not.toHaveURL(/[?&]lang=en\b/)
  await expect(page.getByTestId('language-tab-nl')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('Control+Shift+KeyL')
  await expect(page.getByTestId('language-tab-en')).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Filling in English unblocks ready.
  await page.getByTestId('language-tab-en').focus()
  await titleInput(page).fill(`Concept EN ${suffix}`)
  await richText(page).click()
  await page.keyboard.type('Text in English')
  await waitForSaved(page)
  await expect(page.getByTestId('publish-now')).toBeEnabled()
})

test('a translated title is still there after a reload in that language', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const suffix = uniqueSuffix()
  const { siteSlug } = await createMultilingualSite(page, `cw-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await startNewEntry(page)
  await writeArticle(page, `Nederlandse titel ${suffix}`, 'Nederlandse tekst')
  await waitForSaved(page)

  await page.getByTestId('language-tab-en').click()
  await expect(page).toHaveURL(/[?&]lang=en\b/)
  await titleInput(page).fill(`English title ${suffix}`)
  await waitForSaved(page)

  // Regression: the reloaded draft dropped `$i18n`, so the English title
  // came back empty and ready blamed English for a missing title.
  await page.reload()
  await hydrated(page, page.getByTestId('entry-editor'))
  await expect(page).toHaveURL(/[?&]lang=en\b/)
  await expect(titleInput(page)).toHaveValue(`English title ${suffix}`)
  await page.getByTestId('publish-menu').click()
  await expect(page.getByTestId('ready-blocker')).not.toContainText('Title')

  expect(
    consoleErrors.filter((text) => text.includes('Maximum update depth')),
  ).toEqual([])
})

test('AI translates the empty fields of a language, and one field on request', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createMultilingualSite(page, `ct-${suffix}`)
  const translated: Record<string, string> = {
    title: `Translated title ${suffix}`,
  }
  await stubAi(page, translated)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await startNewEntry(page)
  await writeArticle(page, `Nederlandse titel ${suffix}`, 'Nederlandse tekst')
  await waitForSaved(page)

  // Dutch is the main language: no translate action there.
  await expect(page.getByTestId('translate-language')).toHaveCount(0)

  await page.getByTestId('language-tab-en').click()
  await page.getByTestId('translate-language').click()
  await expect(titleInput(page)).toHaveValue(`Translated title ${suffix}`)
  await expect(
    page.getByText(
      'Translated 1 field from Dutch. Review before marking ready.',
    ),
  ).toBeVisible()
  await waitForSaved(page)

  // Per field: the English title is filled, so the replace confirm comes first.
  translated.title = `Second title ${suffix}`
  await page.getByTestId('translate-field-title').click()
  await expect(
    page.getByText('Replace the English text with a new translation?'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(titleInput(page)).toHaveValue(`Second title ${suffix}`)
})
