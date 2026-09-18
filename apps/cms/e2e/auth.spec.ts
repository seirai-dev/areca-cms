import { expect, test } from '@playwright/test'

import { login, openSite, signOut } from './helpers'

test('unauthenticated / redirects to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('owner login lists the Acme site in the switcher', async ({ page }) => {
  await login(page, 'owner@acme.local')
  await page.getByTestId('sites-nav').click()
  await expect(page.getByRole('link', { name: /acme-site/i })).toBeVisible()
})

test('agency admin sees the Agency section', async ({ page }) => {
  await login(page, 'admin@areca.local')
  await expect(page.getByTestId('agency-nav')).toBeVisible()
  await expect(page.getByTestId('agency-nav')).toHaveText('Agency')
  await expect(page.getByTestId('agency-nav')).toHaveAttribute(
    'href',
    /\/admin\/organizations/,
  )
})

test('editor does not see the Agency section', async ({ page }) => {
  await login(page, 'editor@acme.local')
  await expect(page.getByTestId('agency-nav')).toHaveCount(0)
})

test('owner sees Team on a site; editor does not', async ({ page }) => {
  await login(page, 'owner@acme.local')
  await openSite(page, /acme-site/i)
  await expect(page.getByTestId('team-nav')).toBeVisible()
  await expect(page.getByTestId('team-nav')).toHaveAttribute(
    'href',
    /\/sites\/[^/]+\/team/,
  )

  await signOut(page)

  await login(page, 'editor@acme.local')
  await openSite(page, /acme-site/i)
  await expect(page.getByTestId('team-nav')).toHaveCount(0)
  await expect(page.getByTestId('publish-site')).toHaveCount(0)

  await page
    .getByTestId('collection-articles')
    .getByRole('link', { name: 'Open' })
    .click()
  await page.getByTestId('new-entry').click()
  await expect(page.getByTestId('entry-editor')).toBeVisible()
  await expect(page.getByTestId('publish-menu')).toHaveCount(0)
})

test('sign out returns to /login', async ({ page }) => {
  await login(page, 'owner@acme.local')
  await signOut(page)
})
