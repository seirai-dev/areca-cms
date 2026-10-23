import { expect, test } from '@playwright/test'

import {
  ACME_SITE,
  authForm,
  ADMIN,
  EDITOR,
  EDITOR_REASON,
  OWNER,
  expectDisabledWithReason,
  login,
  openAccountMenu,
  openCollection,
  openSite,
  openSwitcher,
  signOut,
  startNewEntry,
} from './helpers'

test('unauthenticated / redirects to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await authForm(page)
  await expect(
    page.getByRole('heading', { name: /^Sign in to / }),
  ).toBeVisible()
})

test('wrong password shows an inline error in the card', async ({ page }) => {
  await page.goto('/login')
  const form = await authForm(page)
  await page.getByLabel('Email').fill(OWNER)
  await page.getByLabel('Password').fill('not-the-password')
  await form.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('auth-error')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('owner sees People in the site workspace; no Agency, no Settings', async ({
  page,
}) => {
  await login(page, OWNER)
  await openSite(page, ACME_SITE)

  const nav = page.getByTestId('sidebar').getByTestId('site-nav')
  await expect(nav.getByTestId('overview-nav')).toBeVisible()
  await expect(nav.getByTestId('collection-articles')).toBeVisible()
  await expect(nav.getByTestId('library-nav')).toBeVisible()
  await expect(nav.getByTestId('team-nav')).toBeVisible()
  await expect(nav.getByTestId('team-nav')).toHaveAttribute(
    'href',
    /\/sites\/[^/]+\/people$/,
  )
  await expect(nav.getByTestId('settings-nav')).toHaveCount(0)

  // Owners can go live: the tray button is enabled.
  await expect(
    page.getByTestId('release-status').getByTestId('publish-site'),
  ).toBeEnabled()

  // The workspace switcher has no Agency entry for owners.
  await openSwitcher(page)
  await expect(page.getByTestId(`switch-site-${ACME_SITE}`)).toBeVisible()
  await expect(page.getByTestId('agency-nav')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // …and the Agency workspace itself sends them home.
  await page.goto('/agency')
  await expect(page).not.toHaveURL(/\/agency/)
})

test('editor sees no People; Go live and Mark as ready are disabled with the reason', async ({
  page,
}) => {
  await login(page, EDITOR)
  await openSite(page, ACME_SITE)

  const nav = page.getByTestId('sidebar').getByTestId('site-nav')
  await expect(nav.getByTestId('collection-articles')).toBeVisible()
  await expect(nav.getByTestId('library-nav')).toBeVisible()
  await expect(nav.getByTestId('team-nav')).toHaveCount(0)
  await expect(nav.getByTestId('settings-nav')).toHaveCount(0)

  // Visible but disabled, with the reason as a tooltip.
  const goLive = page.getByTestId('release-status').getByTestId('publish-site')
  await expectDisabledWithReason(page, goLive, EDITOR_REASON)

  // No People page for editors, even by URL.
  const siteUrl = page.url().replace(/[?#].*$/, '')
  await page.goto(`${siteUrl}/people`)
  await expect(page.getByTestId('people-page')).toHaveCount(0)

  await page.goto(siteUrl)
  await expect(page.getByTestId('site-overview')).toBeVisible()
  await openCollection(page, 'articles')
  await startNewEntry(page)
  await expectDisabledWithReason(page, page.getByTestId('publish-now'))
  await expect(page.getByTestId('publish-menu')).toBeDisabled()
})

test('the Agency workspace entry is only offered to agency admins', async ({
  page,
}) => {
  await login(page, ADMIN)
  await openSwitcher(page)
  const agency = page.getByTestId('agency-nav')
  await expect(agency).toBeVisible()
  await expect(agency).toContainText('Agency')
  await agency.click()
  await expect(page).toHaveURL(/\/agency$/)
  await expect(page.getByTestId('agency-overview')).toBeVisible()
  const nav = page.getByTestId('sidebar').getByTestId('site-nav')
  await expect(nav).toHaveAttribute('data-workspace', 'agency')
  for (const id of [
    'agency-overview-nav',
    'clients-nav',
    'agency-people-nav',
    'agency-activity-nav',
    'branding-nav',
  ]) {
    await expect(nav.getByTestId(id)).toBeVisible()
  }
  await signOut(page)

  await login(page, EDITOR)
  await openSwitcher(page)
  await expect(page.getByTestId(`switch-site-${ACME_SITE}`)).toBeVisible()
  await expect(page.getByTestId('agency-nav')).toHaveCount(0)
})

test('sign out from the account menu returns to /login', async ({ page }) => {
  await login(page, OWNER)
  const menu = await openAccountMenu(page)
  await expect(menu).toContainText('Acme Owner')
  await expect(menu).toContainText(OWNER)
  await expect(menu.getByTestId('theme-light')).toBeVisible()
  await expect(menu.getByTestId('language-en')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await signOut(page)
  // Signed out for real: the app sends you back to sign in.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('signing in again lands in the last site you used', async ({ page }) => {
  await login(page, OWNER)
  const siteId = await openSite(page, ACME_SITE)
  await signOut(page)

  await login(page, OWNER)
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}(?:\\?.*)?$`))
  await expect(page.getByTestId('site-overview')).toBeVisible()
})
