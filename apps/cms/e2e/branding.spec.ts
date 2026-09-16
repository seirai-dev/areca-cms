import { expect, test } from '@playwright/test'

import { TINY_PNG, login, signOut } from './helpers'

test.describe.configure({ mode: 'serial' })

test('agency admin can whitelabel the CMS and reset it', async ({ page }) => {
  test.setTimeout(90_000)
  const name = `Acme Studio ${Date.now()}`

  await login(page)
  await page.getByTestId('branding-nav').click()
  await expect(page).toHaveURL(/\/admin\/branding$/)
  await expect(page.getByTestId('branding-page')).toBeVisible()
  await expect(page.getByTestId('brand-advanced')).not.toBeChecked()

  await page.getByTestId('brand-name').fill(name)
  await page.getByTestId('brand-accent').fill('#1e90ff')
  await page.getByTestId('brand-email-from').fill('Acme Team')

  // Advanced semantic colours preview live and warn without blocking saves.
  await page.getByTestId('brand-advanced').click()
  await page.getByTestId('brand-light-background').fill('#ffffff')
  await page.getByTestId('brand-light-foreground').fill('#ffffff')
  await expect(page.getByTestId('brand-light-contrast-warnings')).toBeVisible()
  await page.getByTestId('brand-light-background').fill('#f5f7ff')
  await page.getByTestId('brand-light-foreground').fill('#1b2430')
  await page.getByTestId('brand-light-primary').fill('#005bbb')
  await page.getByTestId('brand-light-primaryForeground').fill('#ffffff')
  await expect(page.getByTestId('branding-preview')).toHaveCSS(
    'background-color',
    'rgb(245, 247, 255)',
  )
  await page.getByTestId('save-branding').click()
  await expect(page.getByText('Branding saved')).toBeVisible()

  // The sidebar, tab title, and accent stylesheet update without a reload.
  await expect(page.locator('[data-sidebar="sidebar"]')).toContainText(name)
  await expect(page).toHaveTitle(name)
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-clay-400')
          .trim(),
      ),
    )
    .toMatch(/^oklch\(/)
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--background')
          .trim(),
      ),
    )
    .toBe('#f5f7ff')

  // Turning advanced mode off leaves its values stored but inactive.
  await page.getByTestId('brand-advanced').click()
  await page.getByTestId('save-branding').click()
  await expect(page.getByText('Branding saved')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('brand-advanced')).not.toBeChecked()
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--background')
          .trim(),
      ),
    )
    .not.toBe('#f5f7ff')
  await page.getByTestId('brand-advanced').click()
  await expect(page.getByTestId('brand-light-background')).toHaveValue(
    '#f5f7ff',
  )
  await page.getByTestId('brand-advanced').click()

  // Logo upload swaps the leaf tile for the image.
  await page.getByTestId('brand-logo-input').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  })
  await expect(page.getByText('Logo updated')).toBeVisible()
  await expect(page.getByTestId('brand-logo-preview')).toBeVisible()
  await expect(
    page.locator(
      '[data-sidebar="sidebar"] img[src*="/api/assets/file/branding/logo-"]',
    ),
  ).toBeVisible()

  // The public sign-in page shows the brand too.
  await signOut(page)
  await expect(page.getByText(name)).toBeVisible()
  await expect(page).toHaveTitle(name)

  // Reset restores the defaults.
  await login(page)
  await page.goto('/admin/branding')
  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await page
    .getByTestId('reset-branding')
    .getByRole('button', { name: 'Reset to defaults' })
    .click()
  await expect(page.getByText('Branding reset to defaults')).toBeVisible()
  await expect(page.locator('[data-sidebar="sidebar"]')).toContainText('Areca')
  await expect(page).toHaveTitle('Areca')
  await expect(page.getByTestId('brand-name')).toHaveValue('')
  await expect(page.getByTestId('brand-advanced')).not.toBeChecked()
  await page.getByTestId('brand-advanced').click()
  await expect(page.getByTestId('brand-light-background')).toHaveValue('')
})
