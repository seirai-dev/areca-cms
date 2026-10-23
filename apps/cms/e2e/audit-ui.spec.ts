import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import {
  createIsolatedAcmeSite,
  createArticle,
  openCollection,
  hydrated,
  login,
  openSite,
  openClient,
  slugify,
  startNewEntry,
  titleInput,
  uniqueSuffix,
  waitForSaved,
} from './helpers'

test('content model keeps typed keys and comma choices; optional large choices clear', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const isolated = await createIsolatedAcmeSite(page, `audit-${suffix}`)
  await login(page)
  await openSite(page, isolated.siteSlug)
  await page.getByTestId('sidebar').getByTestId('settings-nav').click()
  await page.getByRole('tab', { name: 'Content', exact: true }).click()
  await hydrated(page, page.getByTestId('content-types'))
  await page.getByTestId('new-content-type').first().click()
  const name = page.getByTestId('collection-label')
  await name.pressSequentially('Travel pages', { delay: 25 })
  await expect(page.getByTestId('collection-key')).toHaveValue('travel-pages')
  await page.getByTestId('collection-key').fill('travel')
  await name.fill('Travel and destinations')
  await expect(page.getByTestId('collection-key')).toHaveValue('travel')
  await page.getByTestId('collection-route').fill('/travel/$slug')
  await page.getByTestId('schema-tab-fields').click()
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-text').click()
  await page.getByTestId('field-label-1').fill('Title')
  await page.getByTestId('field-back').click()
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-select').click()
  await page.getByTestId('field-label-2').fill('Destination')
  const optionsGroup = page.getByRole('group', { name: 'Options', exact: true })
  await expect(optionsGroup).toBeVisible()
  await expect(optionsGroup).toHaveAccessibleDescription(
    'Add one choice per row. Commas stay part of the choice.',
  )
  await expect(optionsGroup.getByRole('textbox')).toHaveCount(0)
  const addChoice = optionsGroup.getByRole('button', {
    name: 'Add choice',
    exact: true,
  })
  await expect(addChoice).toBeVisible()
  await expect(addChoice).toBeEnabled()
  const options = ['Paris, France', 'Ghent', 'London', 'Berlin', 'Rome']
  for (let index = 0; index < options.length; index++) {
    const rows = optionsGroup.getByRole('textbox')
    if ((await rows.count()) <= index) {
      await addChoice.click()
    }
    const option = optionsGroup.getByRole('textbox', {
      name: `Options ${index + 1}`,
      exact: true,
    })
    await expect(option).toHaveAccessibleName(`Options ${index + 1}`)
    await option.fill(options[index])
  }
  await page.getByTestId('save-collection').click()
  await expect(page).toHaveURL(/\/c\/travel$/)
  await page.getByTestId('sidebar').getByTestId('settings-nav').click()
  await page.getByRole('tab', { name: 'Content', exact: true }).click()
  await page.getByTestId('content-type-travel').click()
  await page.getByTestId('schema-tab-fields').click()
  await page.getByTestId('field-row-2').click()
  await expect(page.getByTestId('field-options-2')).toHaveCount(5)
  await expect(page.getByTestId('field-options-2').first()).toHaveValue(
    'Paris, France',
  )
  await page.keyboard.press('Escape')
  await page.getByTestId('sidebar').getByTestId('collection-travel').click()
  await startNewEntry(page)
  await titleInput(page).fill(`Trip ${suffix}`)
  await waitForSaved(page)
  const destination = page.locator('[data-field="destination"]')
  await destination.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Paris, France', exact: true }).click()
  await expect(destination.getByRole('combobox')).toContainText('Paris, France')
  await destination.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(destination.getByRole('combobox')).not.toContainText(
    'Paris, France',
  )
  await expect(
    destination.getByRole('button', { name: 'Clear', exact: true }),
  ).toHaveCount(0)
})

test('new sites retain separate build and schema credentials until each is confirmed', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await login(page)
  await openClient(page, 'Acme', 'acme')
  const suffix = uniqueSuffix()
  const credentials: string[] = []
  for (const label of ['First', 'Second']) {
    await page.getByTestId('new-site').first().click()
    const sheet = page.getByTestId('new-site-sheet')
    const name = `Audit tokens ${label} ${suffix}`
    await sheet.getByTestId('site-name').fill(name)
    await sheet
      .getByTestId('site-production-url')
      .fill(`https://${slugify(name)}.example.com`)
    await sheet.getByTestId('create-site').click()
    await expect(sheet.getByTestId('site-token-alert')).toHaveCount(2)
    for (const variable of ['ARECA_SITE_TOKEN=', 'ARECA_SCHEMA_TOKEN=']) {
      const reveal = sheet
        .getByTestId('site-token-alert')
        .filter({ hasText: variable })
      await expect(reveal).toBeVisible()
      credentials.push(
        (await reveal.getByTestId('site-token-value').innerText()).trim(),
      )
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  }
  expect(new Set(credentials).size).toBe(4)
  const reveals = page.getByTestId('site-token-alert')
  await expect(reveals).toHaveCount(4)
  for (const credential of credentials) {
    await expect(
      page.getByTestId('site-token-value').filter({ hasText: credential }),
    ).toBeVisible()
  }
  await page.reload()
  await hydrated(page, page.getByTestId('organization-page'))
  await expect(reveals).toHaveCount(4)
  const firstCard = reveals.first().locator('..')
  await firstCard
    .getByRole('button', { name: "I've saved it", exact: true })
    .click()
  await expect(reveals).toHaveCount(2)
  for (const credential of credentials.slice(2)) {
    await expect(
      page.getByTestId('site-token-value').filter({ hasText: credential }),
    ).toBeVisible()
  }
})

test('image picker filters before three-page pagination and rejects a PDF upload', async ({
  page,
}) => {
  test.skip(
    !process.env.DATABASE_URL ||
      new URL(process.env.DATABASE_URL).pathname !== '/areca_audit_full',
    'Fake asset rows require the explicitly isolated browser database',
  )
  test.setTimeout(180_000)
  const suffix = uniqueSuffix()
  const isolated = await createIsolatedAcmeSite(page, `media-${suffix}`)
  const connection = new Pool({ connectionString: process.env.DATABASE_URL })
  const prefix = `audit-picker-${suffix}`
  const ids = Array.from({ length: 135 }, () => crypto.randomUUID())
  try {
    const org = (
      await connection.query<{ organization_id: string }>(
        'SELECT organization_id FROM site WHERE slug=$1',
        [isolated.siteSlug],
      )
    ).rows[0].organization_id
    await connection.query(
      `INSERT INTO asset (id, organization_id, storage_key, original_filename, mime_type, size)
      SELECT id, $1, storage_key, original_filename, mime_type, 1 FROM jsonb_to_recordset($2::jsonb)
      AS row(id text, storage_key text, original_filename text, mime_type text)`,
      [
        org,
        JSON.stringify(
          ids.map((id, index) => ({
            id,
            storage_key: `${org}/${id}`,
            original_filename: `${prefix}-${index}.${index < 50 ? 'pdf' : 'png'}`,
            mime_type: index < 50 ? 'application/pdf' : 'image/png',
          })),
        ),
      ],
    )
    await login(page)
    await openSite(page, isolated.siteSlug)
    await openCollection(page)
    await createArticle(page, `Picker ${suffix}`)
    await page.getByTestId('rich-text-editor').locator('p').first().click()
    await page.getByTestId('rich-text-insert').click()
    await page.getByTestId('rich-text-insert-image').click()
    const picker = page.getByTestId('media-picker')
    await picker.getByTestId('media-search').fill(prefix)
    await expect(picker.getByRole('option')).toHaveCount(40)
    await picker.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(picker.getByRole('option')).toHaveCount(80)
    await picker.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect(picker.getByRole('option')).toHaveCount(85)
    await expect(
      picker.getByRole('button', { name: 'Load more', exact: true }),
    ).toHaveCount(0)
    expect(
      await picker
        .getByRole('option')
        .evaluateAll(
          (nodes) =>
            new Set(nodes.map((node) => node.getAttribute('title'))).size,
        ),
    ).toBe(85)
    await expect(picker.locator('[title$=".pdf"]')).toHaveCount(0)
    await picker.getByTestId('media-upload').setInputFiles({
      name: 'blocked.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    })
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ hasText: 'PDFs cannot be used here' }),
    ).toBeVisible()
    await expect(picker).toBeVisible()
  } finally {
    await connection.query('DELETE FROM asset WHERE id=ANY($1::text[])', [ids])
    await connection.end()
  }
})
