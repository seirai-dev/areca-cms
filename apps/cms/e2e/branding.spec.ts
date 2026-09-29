import { expect, test } from '@playwright/test'

import { TINY_PNG, login, signOut } from './helpers'

test.describe.configure({ mode: 'serial' })

test('agency admin can whitelabel the CMS and reset it', async ({ page }) => {
  test.setTimeout(90_000)
  const name = `Acme Studio ${Date.now()}`

  await login(page)
  // Workspace switcher → Agency workspace → Branding.
  await page.getByTestId('sites-nav').click()
  await page.getByTestId('agency-nav').click()
  await page.getByTestId('branding-nav').click()
  await expect(page).toHaveURL(/\/agency\/branding$/)
  await expect(page.getByTestId('branding-page')).toBeVisible()
  await expect(page.getByTestId('brand-legacy-colors')).toHaveCount(0)

  await page.getByTestId('brand-name').fill(name)
  await page.getByTestId('brand-accent').fill('#1e90ff')
  await page.getByTestId('brand-email-from').fill('Acme Team')

  // A preset sets accent and font together; the preview follows immediately.
  await page.getByTestId('brand-preset-indigo').click()
  await expect(page.getByTestId('brand-accent')).toHaveValue('#5b5bd6')
  await expect(page.getByTestId('brand-preset-indigo')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByTestId('brand-accent').fill('#1e90ff')
  await expect(page.getByTestId('brand-preset-indigo')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByTestId('save-branding').click()
  await expect(page.getByText('Branding saved')).toBeVisible()

  // The sidebar, tab title, and accent stylesheet update without a reload.
  // Branding drives the accent tokens, never the ink primary button.
  await expect(page.getByTestId('sidebar')).toContainText(name)
  await expect(page).toHaveTitle(name)
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-accent')
          .trim(),
      ),
    )
    .toMatch(/^oklch\(/)
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-action-primary')
        .trim(),
    ),
  ).not.toMatch(/^oklch\(/)
  // Logo upload swaps the leaf tile for the image.
  await page.getByTestId('brand-logo-input').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  await expect(page.getByText('Logo updated')).toBeVisible()
  await expect(page.getByTestId('brand-logo-preview')).toBeVisible()
  await expect(
    page
      .getByTestId('sidebar')
      .locator('img[src*="/api/assets/file/branding/logo-"]'),
  ).toBeVisible()

  // The public sign-in page shows the brand too.
  await signOut(page)
  await expect(page.getByText(name)).toBeVisible()
  await expect(page).toHaveTitle(name)

  // Reset restores the defaults.
  await login(page)
  await page.goto('/agency/branding')
  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await page
    .getByTestId('reset-branding')
    .getByRole('button', { name: 'Reset to defaults' })
    .click()
  await expect(page.getByText('Branding reset to defaults')).toBeVisible()
  await expect(page.getByTestId('sidebar')).toContainText('Areca')
  await expect(page).toHaveTitle('Areca')
  await expect(page.getByTestId('brand-name')).toHaveValue('')
  await expect(page.getByTestId('brand-legacy-colors')).toHaveCount(0)
  await expect(page.getByTestId('brand-preset-areca')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
