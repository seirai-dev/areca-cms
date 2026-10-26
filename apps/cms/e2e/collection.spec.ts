import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ACME_SITE,
  EDITOR,
  OWNER,
  backToCollection,
  createArticle,
  createIsolatedAcmeSite,
  expectDisabledWithReason,
  hydrated,
  login,
  markAsReady,
  openCollection,
  openSite,
  slugify,
  uniqueSuffix,
} from './helpers'

function entry(page: Page, title: string) {
  return page.getByTestId(`entry-${slugify(title)}`)
}

test('collection: view toggle, status filter and select-mode bulk actions', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createIsolatedAcmeSite(page, `col-${suffix}`)
  const [draftA, ready, draftB] = ['Alpha', 'Bravo', 'Charlie'].map(
    (name) => `${name} ${suffix}`,
  )

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')

  // Header: count whisper and route pattern.
  await expect(page.getByTestId('site-content')).toContainText('/blog/$slug')

  for (const title of [draftA, ready, draftB]) {
    await createArticle(page, title)
    if (title === ready) await markAsReady(page)
    await backToCollection(page)
  }
  await expect(page.getByTestId('site-content')).toContainText('3 entries')

  /* View: Cards by default (the collection has an image field), then List. */
  const cards = page.getByTestId('view-cards')
  const list = page.getByTestId('view-list')
  await expect(cards).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('article[data-testid^="entry-"]')).toHaveCount(3)
  await list.click()
  await expect(list).toHaveAttribute('aria-checked', 'true')
  await expect(
    page.locator('[role="listitem"][data-testid^="entry-"]'),
  ).toHaveCount(3)
  // Remembered per collection.
  await page.reload()
  await hydrated(page, page.getByTestId('site-content'))
  await expect(page.getByTestId('view-list')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(
    page.locator('[role="listitem"][data-testid^="entry-"]'),
  ).toHaveCount(3)

  /* Status filter: the sliding pill control. */
  await page.getByTestId('status-filter-draft').click()
  await expect(page.getByTestId('status-filter-draft')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(entry(page, draftA)).toBeVisible()
  await expect(entry(page, draftB)).toBeVisible()
  await expect(entry(page, ready)).toHaveCount(0)

  await page.getByTestId('status-filter-published').click()
  await expect(entry(page, ready)).toBeVisible()
  await expect(entry(page, ready).getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'ready',
  )
  await expect(entry(page, draftA)).toHaveCount(0)

  await page.getByTestId('status-filter-archived').click()
  const nothing = page.getByTestId('collection-empty-filtered')
  await expect(nothing).toContainText('Nothing matches')
  await nothing.getByRole('button').click()
  await expect(page.getByTestId('status-filter-all')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(
    page.locator('[data-testid^="entry-"][data-entry-id]'),
  ).toHaveCount(3)

  /* Search: `/` focuses it; Escape clears it. */
  await page.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('/')
  const search = page.getByTestId('collection-search')
  await expect(search).toBeFocused()
  await page.keyboard.type('Charlie')
  await expect(entry(page, draftB)).toBeVisible()
  await expect(entry(page, draftA)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(search).toHaveValue('')
  await expect(
    page.locator('[data-testid^="entry-"][data-entry-id]'),
  ).toHaveCount(3)

  /* Select mode with the floating action bar. */
  await page.getByTestId('select-mode').click()
  await expect(page.getByTestId('select-mode')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const bar = page.getByTestId('bulk-actions')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('Select entries')
  await page
    .getByRole('button', { name: `Select ${draftA}`, exact: true })
    .click()
  await page
    .getByRole('button', { name: `Select ${draftB}`, exact: true })
    .click()
  await expect(bar).toContainText('2 selected')
  await expect(entry(page, draftA)).toHaveAttribute('data-selected', 'true')

  await bar.getByTestId('bulk-ready').click()
  await expect(entry(page, draftA).getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'ready',
  )
  await expect(entry(page, draftB).getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'ready',
  )
  await expect(page.getByTestId('release-status')).toContainText(
    '3 changes ready',
  )

  // Back to draft for one of them.
  await page.getByTestId('bulk-done').click()
  await expect(bar).toBeHidden()
  await page.getByTestId('select-mode').click()
  await page
    .getByRole('button', { name: `Select ${draftA}`, exact: true })
    .click()
  await expect(bar).toContainText('1 selected')
  await bar.getByTestId('bulk-draft').click()
  await expect(entry(page, draftA).getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'draft',
  )

  // Each action clears the selection.
  await expect(bar).toContainText('Select entries')

  // Delete asks first.
  await page
    .getByRole('button', { name: `Select ${draftB}`, exact: true })
    .click()
  await bar.getByTestId('bulk-delete').click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Delete this entry?')
  await page.getByTestId('confirm-action').click()
  await expect(entry(page, draftB)).toHaveCount(0)
  await expect(entry(page, draftA)).toBeVisible()
  await expect(entry(page, ready)).toBeVisible()
  await expect(page.getByTestId('site-content')).toContainText('2 entries')
  await page.getByTestId('bulk-done').click()
  await expect(bar).toBeHidden()
})

test('collection: bulk archive two entries on a normal site', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createIsolatedAcmeSite(page, `arch-${suffix}`)
  const [keep, archiveA, archiveB] = ['Keep', 'Archive A', 'Archive B'].map(
    (name) => `${name} ${suffix}`,
  )

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  for (const title of [keep, archiveA, archiveB]) {
    await createArticle(page, title)
    await backToCollection(page)
  }
  await expect(page.getByTestId('site-content')).toContainText('3 entries')

  await page.getByTestId('select-mode').click()
  const bar = page.getByTestId('bulk-actions')
  await page
    .getByRole('button', { name: `Select ${archiveA}`, exact: true })
    .click()
  await page
    .getByRole('button', { name: `Select ${archiveB}`, exact: true })
    .click()
  await expect(bar).toContainText('2 selected')
  await expect(bar.getByTestId('bulk-archive')).toContainText('Archive (2)')

  await bar.getByTestId('bulk-archive').click()
  await expect(
    entry(page, archiveA).getByTestId('entry-status'),
  ).toHaveAttribute('data-ui-status', 'archived')
  await expect(
    entry(page, archiveB).getByTestId('entry-status'),
  ).toHaveAttribute('data-ui-status', 'archived')
  await expect(entry(page, keep).getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'draft',
  )
  // The action clears the selection.
  await expect(bar).toContainText('Select entries')
  await page.getByTestId('bulk-done').click()
  await expect(bar).toBeHidden()
})

test('editors can select entries but bulk actions are disabled with the reason', async ({
  page,
}) => {
  await login(page, EDITOR)
  await openSite(page, ACME_SITE)
  await openCollection(page, 'articles')
  // Editors write drafts; Select needs at least one entry.
  const title = `Editor draft ${uniqueSuffix()}`
  await createArticle(page, title)
  await backToCollection(page)
  await page.getByTestId('select-mode').click()
  await page
    .getByRole('button', { name: `Select ${title}`, exact: true })
    .click()
  const bar = page.getByTestId('bulk-actions')
  await expect(bar).toBeVisible()
  for (const id of ['bulk-ready', 'bulk-draft', 'bulk-delete']) {
    await expect(bar.getByTestId(id)).toBeDisabled()
  }
  await expect(bar).toContainText('1 selected')
  await expectDisabledWithReason(page, bar.getByTestId('bulk-ready'))
  await bar.getByTestId('bulk-done').click()
  await expect(bar).toBeHidden()
})
