import { expect, test } from '@playwright/test'

import {
  OWNER,
  TINY_PNG,
  backToCollection,
  createArticle,
  createIsolatedAcmeSite,
  entryIdFromUrl,
  goLiveFromTray,
  hydrated,
  login,
  markAsReady,
  openCollection,
  openGoLivePanel,
  openSite,
  richText,
  saveStatus,
  slugify,
  startNewEntry,
  titleInput,
  uniqueSuffix,
  waitForSaved,
} from './helpers'

test('owner writes an article in focus mode, marks it ready and goes live', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const title = `E2E Article ${suffix}`
  const { siteSlug } = await createIsolatedAcmeSite(page, `ed-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  await expect(page.getByTestId('collection-empty')).toBeVisible()
  await startNewEntry(page)

  // Focus mode: no sidebar, a slim top bar with the way back.
  await expect(page.getByTestId('sidebar')).toHaveCount(0)
  await expect(page.getByTestId('editor-back')).toHaveAccessibleName(
    'Back to Articles',
  )
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'draft',
  )

  // The slug follows the title.
  await titleInput(page).fill(title)
  await expect(page.getByLabel('Slug', { exact: true })).toHaveValue(
    slugify(title),
  )

  // Autosave creates the entry and replaces /new with its id.
  await richText(page).click()
  await page.keyboard.type('Hello from the e2e editor')
  await waitForSaved(page)
  const entryId = entryIdFromUrl(page)
  // It was a `replace`: Back returns to the collection, not to /new.
  await page.goBack()
  await expect(page).toHaveURL(/\/c\/articles(?:\?.*)?$/)
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/c/articles/${entryId}$`))
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )

  /* Rich text: the format bar's block menu and Insert › Table. */
  const editor = richText(page)
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('rich-text-toolbar')).toBeVisible()
  await page.getByTestId('rich-text-block-type').click()
  await page.getByRole('menuitem', { name: 'Heading 2' }).click()
  await page.keyboard.type('A section heading')
  await expect(editor.locator('h2')).toHaveText('A section heading')
  await page.keyboard.press('Enter')

  await page.getByTestId('rich-text-insert').click()
  await page.getByTestId('rich-text-insert-table').click()
  const table = editor.locator('table')
  await expect(table).toBeVisible()
  await table.locator('th, td').first().click()
  await expect(page.getByTestId('rich-text-table-bar')).toBeVisible()
  await expect(table.locator('tr')).toHaveCount(3)
  await page.getByTestId('rich-text-add-table-row').click()
  await expect(table.locator('tr')).toHaveCount(4)
  await table.locator('tr').nth(1).locator('th, td').first().click()
  await page.getByTestId('rich-text-delete-table-row').click()
  await expect(table.locator('tr')).toHaveCount(3)
  await page.getByTestId('rich-text-add-table-column').click()
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(4)
  await page.getByTestId('rich-text-delete-table-column').click()
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(3)

  /* Image field (details panel): upload through the media picker. */
  const details = page.getByTestId('entry-details')
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: /Choose an image/ }).click()
  const picker = page.getByTestId('media-picker')
  await expect(picker).toBeVisible()
  await picker.getByTestId('media-upload').setInputFiles({
    name: `tiny-${suffix}.png`,
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  // An upload selects itself and closes the picker.
  await expect(picker).toBeHidden()
  await expect(page.getByTestId('image-field-thumb')).toBeVisible()
  await expect(page.getByTestId('image-field-alt-warning')).toBeVisible()

  /* Insert › Image into the body: an image node with four resize handles. */
  await editor.locator('p').first().click()
  await page.getByTestId('rich-text-insert').click()
  await page.getByTestId('rich-text-insert-image').click()
  await expect(picker).toBeVisible()
  await picker.getByTitle(`tiny-${suffix}.png`).first().click()
  await expect(picker).toBeHidden()
  const bodyImage = editor.locator("[data-resize-container][data-node='image']")
  await expect(bodyImage).toBeVisible()
  await expect(bodyImage.locator('[data-resize-handle]')).toHaveCount(4)

  await waitForSaved(page)
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'draft',
  )

  /* Everything survives a reload. */
  await page.reload()
  await hydrated(page, titleInput(page))
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await expect(titleInput(page)).toHaveValue(title)
  await expect(editor).toContainText('Hello from the e2e editor')
  await expect(editor.locator('h2')).toHaveText('A section heading')
  await expect(editor.locator('table')).toBeVisible()
  await expect(
    editor.locator("[data-resize-container][data-node='image']"),
  ).toBeVisible()
  await expect(page.getByTestId('image-field-thumb')).toBeVisible()

  /* Mark as ready, then go live from the tray. */
  await markAsReady(page)
  await expect(page.getByTestId('details-history')).toBeVisible()

  await backToCollection(page)
  const row = page.getByTestId(`entry-${slugify(title)}`)
  await expect(row.getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'ready',
  )
  const tray = page.getByTestId('release-status')
  await expect(tray).toContainText('1 change ready')
  await goLiveFromTray(page)
  await expect(row.getByTestId('entry-status')).toHaveAttribute(
    'data-ui-status',
    'live',
  )

  // The release timeline says who made it live.
  const panel = await openGoLivePanel(page)
  await expect(panel.getByTestId('golive-hero')).toHaveAttribute(
    'data-state',
    'up-to-date',
  )
  const live = panel.getByTestId('publication-live')
  await expect(live).toHaveCount(1)
  await expect(live).toContainText('Went live')
  await expect(live).toContainText('by Acme Owner')
})

test('validation errors show inline and a failed save guards leaving', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createIsolatedAcmeSite(page, `val-${suffix}`)

  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')

  // A new entry is not created until the title gives it a valid address.
  await startNewEntry(page)
  await page.getByLabel('Slug', { exact: true }).fill('Hello World')
  await page.getByTestId('save-draft').click()
  await expect(saveStatus(page)).toHaveText('Not saved yet — add a title')
  await expect(page).toHaveURL(/\/new$/)

  await page.getByLabel('Slug', { exact: true }).fill(`valid-${suffix}`)
  await titleInput(page).fill(`Valid ${suffix}`)
  await richText(page).click()
  await page.keyboard.type('Body')
  await waitForSaved(page)

  // Clearing a required field: the save fails with an inline error.
  await titleInput(page).fill('')
  await page.getByTestId('save-draft').click()
  await expect(saveStatus(page)).toHaveText("Couldn't save — fix 1 field")
  await expect(
    page.getByTestId('editor-canvas').getByRole('alert').first(),
  ).toBeVisible()
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-dirty',
    'true',
  )

  // Leaving now asks first; "Stay" keeps the edit, "Leave" goes.
  await page.getByTestId('editor-back').click()
  const guard = page.getByRole('alertdialog')
  await expect(
    guard.getByText('Leave without saving your latest changes?'),
  ).toBeVisible()
  await guard.getByRole('button', { name: 'Stay' }).click()
  await expect(guard).toBeHidden()
  await expect(page).toHaveURL(/\/c\/articles\/[^/]+$/)

  await page.getByTestId('editor-back').click()
  await page.getByTestId('discard-changes').click()
  await expect(page.getByTestId('site-content')).toHaveAttribute(
    'data-ready',
    'true',
  )
  // The server kept the last good version.
  await expect(page.getByTestId(`entry-valid-${suffix}`)).toContainText(
    `Valid ${suffix}`,
  )

  // Marking an entry ready validates required fields.
  const emptyBody = `Empty body ${suffix}`
  await startNewEntry(page)
  await titleInput(page).fill(emptyBody)
  await waitForSaved(page)
  await page.getByTestId('publish-now').click()
  await expect(
    page
      .locator('[data-sonner-toast], [role="alert"]')
      .filter({ hasText: /Required|Could not|Couldn't|fix/i })
      .first(),
  ).toBeVisible()
  await expect(page.getByTestId('entry-status')).toHaveAttribute(
    'data-status',
    'draft',
  )
})

test('an existing entry opens from the collection and keeps its address', async ({
  page,
}) => {
  test.setTimeout(150_000)
  const suffix = uniqueSuffix()
  const { siteSlug } = await createIsolatedAcmeSite(page, `open-${suffix}`)
  await login(page, OWNER)
  await openSite(page, siteSlug)
  await openCollection(page, 'articles')
  const title = `Kept ${suffix}`
  const id = await createArticle(page, title)
  await backToCollection(page)

  await page.getByTestId(`entry-${slugify(title)}`).getByRole('link').first().click()
  await expect(page).toHaveURL(new RegExp(`/c/articles/${id}$`))
  await expect(page.getByTestId('entry-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  // A saved title no longer drags the slug along once edited by hand.
  await page.getByLabel('Slug', { exact: true }).fill(`custom-${suffix}`)
  await titleInput(page).fill(`${title} renamed`)
  await expect(page.getByLabel('Slug', { exact: true })).toHaveValue(
    `custom-${suffix}`,
  )
  await expect(page.getByTestId('slug-reset')).toBeVisible()
  await page.getByTestId('slug-reset').click()
  await expect(page.getByLabel('Slug', { exact: true })).toHaveValue(
    slugify(`${title} renamed`),
  )
  await waitForSaved(page)
})
