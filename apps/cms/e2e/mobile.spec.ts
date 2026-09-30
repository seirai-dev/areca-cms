import { expect, test } from '@playwright/test'

import { ACME_SITE, OWNER, hydrated, login, openSite } from './helpers'

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

test('phone: top bar, bottom tab bar and the Go-live pill', async ({ page }) => {
  await login(page, OWNER)
  // Pick the site on the picker, or start from it when it is the only one.
  if (!/\/sites\/[^/]+/.test(page.url())) await openSite(page, ACME_SITE)
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await hydrated(page)

  // No sidebar; a compact top bar and a bottom tab bar instead.
  await expect(page.getByTestId('sidebar')).toBeHidden()
  const top = page.getByTestId('mobile-top-bar')
  const tabs = page.getByTestId('mobile-tab-bar')
  await expect(top).toBeVisible()
  await expect(tabs).toBeVisible()
  await expect(top.getByTestId('sites-nav-mobile')).toBeVisible()
  await expect(top.getByTestId('user-menu-mobile')).toBeVisible()
  const siteUrl = page.url().replace(/[?#].*$/, '')

  // Content opens a sheet listing the collections.
  await expect(async () => {
    await tabs.getByTestId('mobile-content').click()
    await expect(page.getByRole('dialog', { name: 'Content' })).toBeVisible({
      timeout: 2_000,
    })
  }).toPass({ timeout: 20_000 })
  await page
    .getByRole('dialog', { name: 'Content' })
    .getByRole('link', { name: /Articles/ })
    .click()
  await expect(page).toHaveURL(/\/c\/articles$/)
  await expect(page.getByTestId('site-content')).toHaveAttribute('data-ready', 'true')

  // Library is a tab.
  await tabs.getByRole('link', { name: 'Library' }).click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library-page')).toBeVisible()

  // More: People, Activity and Go live.
  await tabs.getByTestId('mobile-more').click()
  const more = page.getByRole('dialog', { name: 'More' })
  await expect(more).toBeVisible()
  await expect(more.getByRole('link', { name: /People/ })).toBeVisible()
  await more.getByRole('link', { name: /People/ }).click()
  await expect(page).toHaveURL(/\/people$/)
  await expect(page.getByTestId('people-page')).toBeVisible()

  // Overview tab.
  await tabs.getByRole('link', { name: 'Overview' }).click()
  await expect(page).toHaveURL(new RegExp(`${siteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))

  // The Go-live pill in the top bar opens the panel as a sheet.
  const pill = top.getByTestId('golive-pill')
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute('data-state', /never-live|ready|up-to-date/)
  await pill.click()
  await expect(page).toHaveURL(/[?&]panel=golive/)
  const panel = page.getByTestId('golive-panel')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(380)
})
