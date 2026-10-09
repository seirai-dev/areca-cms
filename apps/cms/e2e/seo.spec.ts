import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import {
  ACME_SITE,
  OWNER,
  PASSWORD,
  createArticle,
  entryIdFromUrl,
  hydrated,
  login,
  openCollection,
  openSite,
  titleInput,
  uniqueSuffix,
  waitForSaved,
} from './helpers'

/** Signs in as the seeded owner (no two-factor) and opens Acme's Articles. */
async function openOwnerArticles(page: Page) {
  await login(page, OWNER, PASSWORD)
  await openSite(page, ACME_SITE)
  await openCollection(page, 'articles')
}

/**
 * Deletes the entry open in the editor: "More actions" → Delete, then confirm.
 * Retries the menu open while the editor is still hydrating.
 */
async function deleteOpenEntry(page: Page) {
  const entryId = entryIdFromUrl(page)
  const remove = page.getByTestId('delete-entry')
  await expect(async () => {
    if (!(await remove.isVisible())) {
      await page.getByTestId('entry-more').click()
    }
    await expect(remove).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await remove.click()
  await page.getByTestId('confirm-action').click()
  await expect(page).not.toHaveURL(
    new RegExp(`/c/[^/]+/${entryId}(?:[?#]|$)`),
    {
      timeout: 30_000,
    },
  )
}

/**
 * Cleanup that runs even when the test fails: returns to the entry's URL and
 * deletes it, so no `E2E SEO%` rows are left behind.
 */
async function cleanupEntry(page: Page, entryUrl: string) {
  await page.goto(entryUrl)
  await hydrated(page, titleInput(page))
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await deleteOpenEntry(page)
}

/** Opens one group of the SEO & discovery card if it is collapsed. */
async function openSeoGroup(page: Page, group: string) {
  const toggle = page.getByTestId(`${group}-toggle`)
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
    }
    await expect(page.getByTestId(group)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** The details panel holds the SEO card (desktop shows it by default). */
async function seoCard(page: Page): Promise<Locator> {
  const details = page.getByTestId('entry-details')
  await expect(async () => {
    if (!(await details.isVisible())) {
      await page.getByTestId('toggle-details').click()
    }
    await expect(details).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  const card = page.getByTestId('details-seo')
  await expect(card).toBeVisible()
  return card
}

test('SEO fields and FAQ persist across a reload; invalid Extra JSON-LD is rejected', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const title = `E2E SEO ${suffix}`
  const seoTitle = `SEO title ${suffix}`
  const description = `A meta description for the e2e run ${suffix}.`
  const keyphrase = `e2e keyphrase ${suffix}`
  const question = `What is covered in ${suffix}?`
  const answer = `The e2e answer ${suffix}.`

  await openOwnerArticles(page)
  await createArticle(page, title)
  const entryUrl = page.url()

  try {
    await seoCard(page)

    /* Search group (open by default). */
    await openSeoGroup(page, 'seo-group-search')
    await page.getByLabel('SEO title', { exact: true }).fill(seoTitle)
    await page.getByLabel('Meta description', { exact: true }).fill(description)
    await page.getByLabel('Focus keyphrase', { exact: true }).fill(keyphrase)
    await expect(page.getByTestId('seo-search-preview')).toContainText(seoTitle)

    /* AI answers (GEO) group: one FAQ item. */
    await openSeoGroup(page, 'seo-group-answers')
    await page.getByRole('button', { name: 'Add question' }).click()
    await page.getByLabel('Question 1', { exact: true }).fill(question)
    await page.getByLabel('Answer 1', { exact: true }).fill(answer)

    await waitForSaved(page)

    /* Everything survives a reload. */
    await page.reload()
    await hydrated(page, titleInput(page))
    await expect(page.getByTestId('entry-editor')).toHaveAttribute(
      'data-ready',
      'true',
    )
    await seoCard(page)
    await openSeoGroup(page, 'seo-group-search')
    await expect(page.getByLabel('SEO title', { exact: true })).toHaveValue(
      seoTitle,
    )
    await expect(
      page.getByLabel('Meta description', { exact: true }),
    ).toHaveValue(description)
    await expect(
      page.getByLabel('Focus keyphrase', { exact: true }),
    ).toHaveValue(keyphrase)

    await openSeoGroup(page, 'seo-group-answers')
    await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue(
      question,
    )
    await expect(page.getByLabel('Answer 1', { exact: true })).toHaveValue(
      answer,
    )
  } finally {
    await cleanupEntry(page, entryUrl)
  }
})

test('an invalid Extra JSON-LD is rejected by the server and named under the field', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const title = `E2E SEO JSON-LD ${suffix}`

  await openOwnerArticles(page)
  await createArticle(page, title)
  const entryUrl = page.url()

  try {
    await seoCard(page)
    await openSeoGroup(page, 'seo-group-advanced')
    const jsonLd = page.getByLabel('Extra JSON-LD', { exact: true })
    await jsonLd.fill('{"@type": "Article"')

    const message = 'Must be a JSON object or an array of objects'
    await expect(
      page.getByTestId('details-seo').getByText(message),
    ).toBeVisible({
      timeout: 30_000,
    })

    // A valid object clears the error and autosave succeeds again.
    await jsonLd.fill('{"@type": "Article"}')
    await expect(
      page.getByTestId('details-seo').getByText(message),
    ).toHaveCount(0, { timeout: 30_000 })
    await waitForSaved(page)
  } finally {
    await cleanupEntry(page, entryUrl)
  }
})
