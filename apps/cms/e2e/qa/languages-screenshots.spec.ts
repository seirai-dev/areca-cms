/**
 * Screenshots of the multilingual UI for design review (not assertions).
 *
 * Seeds a Dutch-main site (nl, en, fr) with a "Vacancies" collection and a
 * "Company info" global, then captures the editor, list, settings, schema,
 * library and global screens into /tmp/areca-i18n-shots/.
 *
 * Runs only against the isolated stack (database areca_e2e):
 *   node scripts/e2e-isolated.mjs --project=setup --project=qa e2e/qa/languages-screenshots.spec.ts
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ADMIN,
  OWNER,
  TINY_PNG,
  backToCollection,
  createSiteOnClientPage,
  entryIdFromUrl,
  hydrated,
  login,
  openClient,
  openCollection,
  openSite,
  pushManifest,
  stubAi,
  richText,
  signOut,
  startNewEntry,
  titleInput,
  waitForSaved,
} from '../helpers'
import { CMS_ROOT } from './helpers'

const SHOTS = '/tmp/areca-i18n-shots'

const MANIFEST = {
  languages: { main: 'nl', all: ['nl', 'en', 'fr'] },
  collections: {
    vacancies: {
      route: '/vacatures/$slug',
      label: 'Vacancies',
      requiredLanguages: ['en'],
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true, translatable: true },
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'body', label: 'Body', type: 'richtext', required: true, translatable: true },
        { key: 'salary', label: 'Salary', type: 'number' },
        { key: 'location', label: 'Location', type: 'text', translatable: false },
      ],
    },
  },
  globals: {
    companyInfo: {
      label: 'Company info',
      fields: [
        { key: 'email', label: 'Email', type: 'text', required: true, group: 'Contact' },
        { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
        { key: 'tagline', label: 'Tagline', type: 'text', translatable: true, group: 'About' },
      ],
    },
  },
}

const ENTRY_A_NL_TITLE = 'Backend ontwikkelaar'
const ENTRY_A_NL_BODY = [
  'Wij zoeken een backend ontwikkelaar die ons platform verder bouwt. Je werkt dagelijks met TypeScript, PostgreSQL en een team van zes ontwikkelaars.',
  'Je hebt minimaal drie jaar ervaring met API-ontwerp en denkt graag mee over de architectuur van een groeiend product.',
  'Wij bieden een hybride werkplek in Utrecht, een flexibel salaris, een budget voor scholing en vier weken vakantie bovenop de wettelijke dagen.',
]
const ENTRY_A_EN_TITLE = 'Backend developer'

const ENTRY_B_NL_TITLE = 'Verpleegkundige cardiologie'
const ENTRY_B_NL_BODY = [
  'Op onze afdeling cardiologie zoeken we een verpleegkundige die het team versterkt in de zorg voor patiënten na een hartoperatie.',
]
const ENTRY_B_EN_TITLE = 'Cardiology nurse'
const ENTRY_B_EN_BODY = [
  'Our cardiology ward is looking for a nurse to strengthen the team caring for patients after heart surgery.',
]

const ENTRY_C_NL_TITLE = 'Marketingmedewerker'
const ENTRY_C_NL_BODY = [
  'Je bedenkt campagnes voor onze klanten en houdt de resultaten scherp in de gaten.',
]

/**
 * Autosave runs 2s after the last change. `waitForSaved` alone can pass on the
 * previous "Saved" state, so wait for the dirty flag first.
 */
async function saveTyped(page: Page) {
  await expect(page.getByTestId('entry-editor')).toHaveAttribute('data-dirty', 'true', {
    timeout: 5_000,
  })
  await waitForSaved(page)
}

async function ensureLang(page: Page, code: string) {
  const tab = page.getByTestId(`language-tab-${code}`)
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

/** Switches to English and waits until the main-language reference has rendered. */
async function switchToEnglish(page: Page) {
  await page.getByTestId('language-tab-en').click()
  await expect(page).toHaveURL(/[?&]lang=en\b/)
  await expect(page.getByTestId('main-reference-title')).toBeVisible()
  await expect(page.getByTestId('main-reference-body')).toBeVisible()
}

async function writeBody(page: Page, paragraphs: string[]) {
  await richText(page).click()
  for (const [index, paragraph] of paragraphs.entries()) {
    if (index > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(paragraph)
  }
}

async function shot(page: Page, name: string) {
  // Let fades and springs settle before capturing.
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, name) })
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  // next-themes persists the choice under `areca.theme` and sets the class on <html>.
  await page.evaluate((value) => localStorage.setItem('areca.theme', value), theme)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

function runCmsScript(script: string) {
  execSync(`pnpm run ${script}`, { cwd: CMS_ROOT, stdio: 'inherit', env: process.env })
}

test.use({ colorScheme: 'light' })

test.beforeAll(() => {
  // Only ever the isolated database (the runner sets DATABASE_URL to areca_e2e).
  const database = new URL(process.env.DATABASE_URL ?? '')
  if (database.pathname !== '/areca_e2e') {
    throw new Error(`Refusing to seed ${database.pathname}: expected /areca_e2e`)
  }
  runCmsScript('db:reset')
  runCmsScript('db:seed')
})

test.afterAll(() => {
  // Leave the isolated database in the standard seed state.
  runCmsScript('db:reset')
  runCmsScript('db:seed')
})

test('multilingual UI screenshots', async ({ page }) => {
  test.setTimeout(900_000)
  mkdirSync(SHOTS, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  /* --- Seed: site, manifest, entries ------------------------------------ */

  await login(page, ADMIN)
  await openClient(page, 'Acme', 'acme')
  const site = await createSiteOnClientPage(page, 'Verbeek', 'Bakkerij')
  await pushManifest(new URL(page.url()).origin, site.schemaToken, MANIFEST)
  await signOut(page)

  // AI is not set up on the isolated stack. Stub availability (and the
  // translate reply) so the AI actions show; no request reaches a provider.
  await stubAi(page, { title: 'Translated title' })

  await login(page, OWNER)
  const siteId = await openSite(page, site.siteSlug)
  await openCollection(page, 'vacancies')

  // (a) NL complete, EN partial (title only).
  await startNewEntry(page)
  await ensureLang(page, 'nl')
  await titleInput(page).fill(ENTRY_A_NL_TITLE)
  await writeBody(page, ENTRY_A_NL_BODY)
  await page.getByLabel('Salary', { exact: true }).fill('3800')
  await page.getByLabel('Location', { exact: true }).fill('Utrecht')
  await saveTyped(page)
  const entryA = entryIdFromUrl(page)
  await switchToEnglish(page)
  await titleInput(page).fill(ENTRY_A_EN_TITLE)
  await expect(titleInput(page)).toHaveValue(ENTRY_A_EN_TITLE)
  await saveTyped(page)

  // (b) NL + EN complete.
  await backToCollection(page)
  await startNewEntry(page)
  await ensureLang(page, 'nl')
  await titleInput(page).fill(ENTRY_B_NL_TITLE)
  await writeBody(page, ENTRY_B_NL_BODY)
  await saveTyped(page)
  await switchToEnglish(page)
  await titleInput(page).fill(ENTRY_B_EN_TITLE)
  await expect(titleInput(page)).toHaveValue(ENTRY_B_EN_TITLE)
  await writeBody(page, ENTRY_B_EN_BODY)
  await saveTyped(page)

  // (c) NL only.
  await backToCollection(page)
  await startNewEntry(page)
  await ensureLang(page, 'nl')
  await titleInput(page).fill(ENTRY_C_NL_TITLE)
  await writeBody(page, ENTRY_C_NL_BODY)
  await saveTyped(page)
  await backToCollection(page)

  const editorPath = (id: string, lang: string) =>
    `/sites/${siteId}/c/vacancies/${id}?lang=${lang}`
  const openEditor = async (id: string, lang: string) => {
    await page.goto(editorPath(id, lang))
    await hydrated(page, page.getByTestId('entry-editor'))
    await expect(titleInput(page)).toBeVisible()
  }
  const openList = async (query = '') => {
    await page.goto(`/sites/${siteId}/c/vacancies${query}`)
    await hydrated(page, page.getByTestId('site-content'))
  }

  /* --- Light: editor NL/EN, list, list filter ---------------------------- */

  await openEditor(entryA, 'nl')
  await shot(page, 'editor-nl.png')

  await openEditor(entryA, 'en')
  await shot(page, 'editor-en.png')

  await openList()
  await shot(page, 'list.png')

  await page.getByTestId('missing-language-filter').click()
  await page.getByTestId('missing-language-en').click()
  await expect(page).toHaveURL(/missing=en/)
  await shot(page, 'list-filter.png')

  /* --- Dark: the same three ----------------------------------------------- */

  await setTheme(page, 'dark')
  await openList()
  await shot(page, 'list-dark.png')

  await openList('?missing=en')
  await shot(page, 'list-filter-dark.png')

  await openEditor(entryA, 'nl')
  await shot(page, 'editor-nl-dark.png')

  await openEditor(entryA, 'en')
  await shot(page, 'editor-en-dark.png')

  /* --- Light again: ready gating, scroll, mobile -------------------------- */

  await setTheme(page, 'light')
  await hydrated(page, page.getByTestId('entry-editor'))

  await page.getByTestId('publish-menu').click()
  await expect(page.getByTestId('ready-blocker')).toBeVisible()
  await shot(page, 'editor-en-ready-blocked.png')
  await page.keyboard.press('Escape')

  await page.mouse.move(720, 500)
  await page.mouse.wheel(0, 700)
  await page.waitForTimeout(500)
  await shot(page, 'editor-en-scrolled.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(entryA, 'en')
  await shot(page, 'editor-en-mobile.png')
  await page.setViewportSize({ width: 1440, height: 900 })

  /* --- Settings: languages and the add popover (agency admins only) ------- */

  await signOut(page)
  await login(page, ADMIN)
  await openSite(page, site.siteSlug)
  await page.goto(`/sites/${siteId}/settings?tab=languages`)
  await hydrated(page, page.getByTestId('settings-languages'))
  await shot(page, 'settings-languages.png')

  const addLanguages = page.getByTestId('add-languages')
  if (await addLanguages.isVisible()) await addLanguages.click()
  await page.getByTestId('add-language').click()
  await expect(page.getByTestId('language-search')).toBeVisible()
  await shot(page, 'settings-languages-add.png')
  await page.keyboard.press('Escape')

  /* --- Schema editor: a field expanded ------------------------------------ */

  await openList()
  await page.getByTestId('collection-menu').click()
  await page.getByTestId('edit-structure').click()
  await page.getByTestId('field-label-1').click()
  await expect(page.getByTestId('field-translatable-1')).toBeVisible()
  await shot(page, 'schema-field.png')

  await page.getByTestId('field-back').click()
  await page.getByTestId('schema-tab-settings').click()
  await expect(page.getByTestId('required-language-en')).toBeVisible()
  await shot(page, 'schema-settings.png')
  await page.keyboard.press('Escape')

  /* --- Library: per-language alt text ------------------------------------- */

  const assetName = 'verbeek-pixel.png'
  await page.goto(`/sites/${siteId}/library`)
  await expect(page.getByTestId('library-page')).toBeVisible()
  await hydrated(page, page.getByTestId('library-page'))
  await page.getByTestId('library-page').getByTestId('media-upload').setInputFiles({
    name: assetName,
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  const tile = page.getByTestId(`media-card-${assetName}`)
  await expect(tile).toBeVisible()
  await tile.click()
  await expect(page.getByTestId('asset-drawer')).toBeVisible()
  await page.locator('#asset-alt').fill('Een klein transparant pixel')
  await page.locator('#asset-alt').press('Enter')
  await page.locator('#asset-alt-en').fill('A small transparent pixel')
  await page.locator('#asset-alt-en').press('Enter')
  await expect(page.getByTestId('asset-alt-status-en')).toContainText('Saved')
  await shot(page, 'library-alt.png')

  /* --- Global section in EN ---------------------------------------------- */

  await page.goto(`/sites/${siteId}/globals/companyInfo?lang=en`)
  await hydrated(page, page.getByTestId('global-editor'))
  await shot(page, 'global-en.png')
})
