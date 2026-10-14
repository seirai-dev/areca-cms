/**
 * Site content (globals): single-instance sections per site.
 *
 * CONTRACT for the UI (red until implemented). Test ids and accessible names:
 *
 * Sidebar (site workspace)
 * - `site-content-group`            the "Site content" group container; its
 *                                   heading text is "Site content". Hidden for
 *                                   non-agency users when no section is enabled.
 * - `site-content-item-<key>`       one item per section (link to
 *                                   /sites/$siteId/globals/<key>), label = section
 *                                   label. Agency only: disabled sections stay,
 *                                   dimmed, with an "Off" tag.
 *
 * Section editor (route /sites/$siteId/globals/$globalKey)
 * - `global-editor`                 editor root. `data-ready="true"` once loaded,
 *                                   `data-dirty="true|false"` like `entry-editor`.
 * - `save-status`                   existing autosave indicator ("Saved", ...).
 * - Buttons by role + exact name: "Mark as ready" (owners; editors see it disabled
 *   with the EDITOR_REASON tooltip), "Ready" (disabled after marking),
 *   "Discard draft" (no confirmation dialog).
 * - Field inputs by label: `getByLabel('Email', { exact: true })`. The
 *   accessible name is exactly the field label (no "*" in it).
 * - Group heading: `getByRole('heading', { name: 'Contact', exact: true })`,
 *   rendered above the first field of that group.
 *
 * Settings → Content (agency)
 * - `global-types`                  container listing sections under "Site content".
 * - `new-global`                    button that opens the section schema sheet.
 * - `global-row-<key>`              a section row (contains label and "N fields").
 * - `global-enabled-<key>`          its enable switch (`aria-checked`).
 * - `global-drawer`                 the schema editor sheet in "global" mode.
 * - `global-label`, `global-key`    the Settings tab inputs (key typed explicitly).
 * - `save-global`                   save button.
 * - Fields reuse the schema editor ids: `add-field`, `field-type-tile-<type>`,
 *   `field-label-<i>`, `field-key-<i>`, `field-required-<i>`, `field-back`,
 *   `field-list`, `schema-tab-fields`, plus `field-group-<i>` (the "Group heading"
 *   input, accessible name "Group heading"). No slug row (`[data-locked]` absent).
 *
 * Command palette (Cmd/Ctrl+K)
 * - `command-palette` lists a "Go to" group with one option per enabled section.
 *
 * Go live
 * - `release-status` (sidebar tray), `publish-site` (its Go live button),
 *   `golive-panel`, `publication-live`. Section changes appear in the panel with
 *   their label ("Company info"). Blocked sections show the message
 *   `Site content "Company info" has required fields and has never been marked ready.`
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ADMIN,
  ARTICLES_MANIFEST,
  COMPANY_INFO_GLOBAL,
  EDITOR,
  OWNER,
  createIsolatedAcmeSite,
  expectDisabledWithReason,
  goLiveFromTray,
  hydrated,
  login,
  manifestWithGlobals,
  closePanel,
  openGoLivePanel,
  openSite,
  pushSiteManifest,
  saveStatus,
  signOut,
  siteIdFromUrl,
  uniqueSuffix,
} from './helpers'
import type { CreatedSite } from './helpers'

const SECTION_MESSAGE =
  'Site content "Company info" has required fields and has never been marked ready.'

/** Sidebar item for a section, then wait until the section editor is ready. */
async function openSectionFromSidebar(page: Page, key = 'companyInfo') {
  await page
    .getByTestId('sidebar')
    .getByTestId(`site-content-item-${key}`)
    .click()
  await expect(page).toHaveURL(new RegExp(`/globals/${key}(?:\\?.*)?$`))
  await expect(page.getByTestId('global-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await hydrated(page, page.getByTestId('global-editor'))
}

function markReadyButton(page: Page) {
  return page.getByRole('button', { name: 'Mark as ready', exact: true })
}

function discardDraftButton(page: Page) {
  return page.getByRole('button', { name: 'Discard draft', exact: true })
}

/** Autosave settled after an edit: "Saved" and not dirty. */
async function waitForSectionSaved(page: Page) {
  await expect(page.getByTestId('global-editor')).toHaveAttribute(
    'data-dirty',
    'false',
    { timeout: 20_000 },
  )
  await expect(saveStatus(page)).toHaveText(/Saved/, { timeout: 20_000 })
  await expect(saveStatus(page)).not.toHaveAttribute(
    'data-state',
    /saving|failed|blocked/,
  )
}

/** Navigates back to the site overview (fresh sidebar and tray data). */
async function backToOverview(page: Page) {
  const siteId = siteIdFromUrl(page)
  await page.goto(`/sites/${siteId}`)
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await hydrated(page, page.getByTestId('sidebar'))
}

test('agency pushes site content sections and the sidebar group follows them', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const site = await createIsolatedAcmeSite(page, `glob-${suffix}`)

  // No sections yet: editors see no "Site content" group at all.
  await login(page, EDITOR)
  await openSite(page, site.siteSlug)
  await expect(page.getByTestId('site-content-group')).toHaveCount(0)
  await signOut(page)

  // The agency pushes a manifest with one section (the manifest is a full sync).
  await pushSiteManifest(
    page,
    site,
    manifestWithGlobals({ companyInfo: COMPANY_INFO_GLOBAL }),
  )

  // Editor: the group heading and the section item, labelled "Company info".
  await login(page, EDITOR)
  await openSite(page, site.siteSlug)
  const group = page.getByTestId('site-content-group')
  await expect(group).toBeVisible()
  await expect(group).toContainText('Site content')
  await expect(
    page.getByTestId('sidebar').getByTestId('site-content-item-companyInfo'),
  ).toHaveText(/Company info/)
  await signOut(page)

  // Owner sees the same group.
  await login(page, OWNER)
  await openSite(page, site.siteSlug)
  await expect(page.getByTestId('site-content-group')).toContainText(
    'Company info',
  )
  await signOut(page)

  // Pushing without globals disables every section again: the group goes.
  await pushSiteManifest(page, site, ARTICLES_MANIFEST)
  await login(page, EDITOR)
  await openSite(page, site.siteSlug)
  await expect(page.getByTestId('site-content-group')).toHaveCount(0)
})

test('agency creates a section in Settings → Content and disables it', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const site = await createIsolatedAcmeSite(page, `gsec-${suffix}`)

  await login(page, ADMIN)
  const siteId = await openSite(page, site.siteSlug)

  /* Settings → Content lists the sections next to the content types. */
  await page.getByTestId('sidebar').getByTestId('settings-nav').click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/settings`))
  await page.getByRole('tab', { name: 'Content' }).click()
  await expect(page).toHaveURL(/[?&]tab=content/)
  await expect(page.getByTestId('global-types')).toBeVisible()
  await page.getByTestId('new-global').first().click()

  const drawer = page.getByTestId('global-drawer')
  await expect(drawer).toBeVisible()
  await page.getByTestId('global-label').fill('Company info')
  await page.getByTestId('global-key').fill('companyInfo')

  // Fields: no slug row in a section. The first field is "Email" (required,
  // under the "Contact" heading), then "Phone".
  await page.getByTestId('schema-tab-fields').click()
  await expect(page.locator('[data-locked="true"]')).toHaveCount(0)
  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-text').click()
  await page.getByTestId('field-label-0').fill('Email')
  await expect(page.getByTestId('field-key-0')).toHaveValue('email')
  await page.getByTestId('field-required-0').click()
  await page.getByTestId('field-group-0').fill('Contact')
  await page.getByTestId('field-back').click()

  await page.getByTestId('add-field').click()
  await page.getByTestId('field-type-tile-text').click()
  await page.getByTestId('field-label-1').fill('Phone')
  await page.getByTestId('field-back').click()
  await expect(page.getByTestId('field-list')).toBeVisible()
  await expect(page.getByTestId('field-key-0')).toHaveText('email')
  await expect(page.getByTestId('field-key-1')).toHaveText('phone')

  await page.getByTestId('save-global').click()
  await expect(drawer).toBeHidden()
  const row = page.getByTestId('global-row-companyInfo')
  await expect(row).toBeVisible()
  await expect(row).toContainText('Company info')
  await expect(row).toContainText('2 fields')

  // The agency sees the new section in the sidebar group.
  await page.getByTestId('sidebar').getByTestId('overview-nav').click()
  await expect(
    page.getByTestId('sidebar').getByTestId('site-content-item-companyInfo'),
  ).toBeVisible()

  // Disable it from the Content tab: the agency still sees it, dimmed with "Off".
  await page.getByTestId('sidebar').getByTestId('settings-nav').click()
  await page.getByRole('tab', { name: 'Content' }).click()
  const enabled = page.getByTestId('global-enabled-companyInfo')
  await expect(enabled).toHaveAttribute('aria-checked', 'true')
  await enabled.click()
  await expect(enabled).toHaveAttribute('aria-checked', 'false')
  await expect(row.getByText('Off', { exact: true })).toBeVisible()
  await expect(
    page
      .getByTestId('sidebar')
      .getByTestId('site-content-item-companyInfo')
      .getByText('Off', { exact: true }),
  ).toBeVisible()
  await signOut(page)

  // Editors no longer see it (no enabled sections: no group at all).
  await login(page, EDITOR)
  await openSite(page, site.siteSlug)
  await expect(page.getByTestId('site-content-group')).toHaveCount(0)
})

test('editor fills a section, owner marks it ready and it ships with go live', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const suffix = uniqueSuffix()
  const site: CreatedSite = await createIsolatedAcmeSite(
    page,
    `gedit-${suffix}`,
  )
  await pushSiteManifest(
    page,
    site,
    manifestWithGlobals({ companyInfo: COMPANY_INFO_GLOBAL }),
  )
  const email = `hello-${suffix}@acme.test`

  /* Editor: draft only. */
  await login(page, EDITOR)
  await openSite(page, site.siteSlug)
  await openSectionFromSidebar(page)

  // Editors see the action disabled, with the reason.
  await expectDisabledWithReason(page, markReadyButton(page))

  // The grouped field sits under its "Contact" heading (heading above the field).
  const heading = page.getByRole('heading', { name: 'Contact', exact: true })
  const emailInput = page.getByLabel('Email', { exact: true })
  await expect(heading).toBeVisible()
  await expect(emailInput).toBeVisible()
  const headingBox = await heading.boundingBox()
  const emailBox = await emailInput.boundingBox()
  expect(headingBox && emailBox && headingBox.y < emailBox.y).toBe(true)

  // Autosave: edit, then the status settles to Saved.
  await emailInput.fill(email)
  await waitForSectionSaved(page)
  await signOut(page)

  /* Owner: marks ready. */
  await login(page, OWNER)
  await openSite(page, site.siteSlug)
  await openSectionFromSidebar(page)
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email)
  await markReadyButton(page).click()
  await expect(
    page.getByRole('button', { name: 'Ready', exact: true }),
  ).toBeDisabled()

  /* Go live tray: the section change is listed with its label. */
  await backToOverview(page)
  await expect(page.getByTestId('release-status')).toContainText(
    '1 change ready',
  )
  const panel = await openGoLivePanel(page)
  await expect(panel).toContainText('Company info')
  // The panel's overlay would block the tray button: close it first.
  await closePanel(page)
  await goLiveFromTray(page)
  const live = (await openGoLivePanel(page)).getByTestId('publication-live')
  await expect(live).toHaveCount(1)
  await expect(live).toContainText('Went live')
})

test('discard draft returns a section field to its ready value', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const site = await createIsolatedAcmeSite(page, `gdisc-${suffix}`)
  await pushSiteManifest(
    page,
    site,
    manifestWithGlobals({ companyInfo: COMPANY_INFO_GLOBAL }),
  )
  const readyEmail = `ready-${suffix}@acme.test`
  const draftEmail = `draft-${suffix}@acme.test`

  await login(page, OWNER)
  await openSite(page, site.siteSlug)
  await openSectionFromSidebar(page)
  await page.getByLabel('Email', { exact: true }).fill(readyEmail)
  await waitForSectionSaved(page)
  await markReadyButton(page).click()
  await expect(
    page.getByRole('button', { name: 'Ready', exact: true }),
  ).toBeDisabled()

  // A newer draft, saved but not ready.
  await page.getByLabel('Email', { exact: true }).fill(draftEmail)
  await waitForSectionSaved(page)
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    draftEmail,
  )

  await discardDraftButton(page).click()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    readyEmail,
  )

  // The reverted value is what the server kept, not just the form state.
  await page.reload()
  await hydrated(page, page.getByTestId('global-editor'))
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    readyEmail,
  )
})

test('go live is blocked while a required section has never been marked ready', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const site = await createIsolatedAcmeSite(page, `gblock-${suffix}`)
  await pushSiteManifest(
    page,
    site,
    manifestWithGlobals({ companyInfo: COMPANY_INFO_GLOBAL }),
  )
  const email = `blocked-${suffix}@acme.test`

  await login(page, OWNER)
  await openSite(page, site.siteSlug)

  // Never ready: the tray cannot publish and the reason is shown.
  const tray = page.getByTestId('release-status')
  await expect(tray.getByTestId('publish-site')).toBeDisabled()
  const panel = await openGoLivePanel(page)
  await expect(panel.getByText(SECTION_MESSAGE)).toBeVisible()
  await closePanel(page)

  // Ready with valid data: the blocker goes and the change can ship.
  await openSectionFromSidebar(page)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await waitForSectionSaved(page)
  await markReadyButton(page).click()
  await expect(
    page.getByRole('button', { name: 'Ready', exact: true }),
  ).toBeDisabled()
  await backToOverview(page)
  await expect(page.getByText(SECTION_MESSAGE)).toHaveCount(0)
  await expect(page.getByTestId('release-status')).toContainText(
    '1 change ready',
  )
})

test('Cmd+K lists enabled sections under Go to', async ({ page }) => {
  test.setTimeout(240_000)
  const suffix = uniqueSuffix()
  const site = await createIsolatedAcmeSite(page, `gcmd-${suffix}`)
  await pushSiteManifest(
    page,
    site,
    manifestWithGlobals({ companyInfo: COMPANY_INFO_GLOBAL }),
  )

  await login(page, OWNER)
  await openSite(page, site.siteSlug)
  const input = page.getByTestId('command-input')
  await expect(async () => {
    if (!(await input.isVisible())) {
      await page.keyboard.press('ControlOrMeta+k')
    }
    await expect(input).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })

  const list = page.getByTestId('command-palette')
  await expect(list.getByText('Go to', { exact: true })).toBeVisible()
  const option = list.getByRole('option').filter({ hasText: 'Company info' })
  await expect(option).toBeVisible()
  await option.click()
  await expect(page).toHaveURL(/\/globals\/companyInfo(?:\?.*)?$/)
  await expect(page.getByTestId('global-editor')).toHaveAttribute(
    'data-ready',
    'true',
  )
})
