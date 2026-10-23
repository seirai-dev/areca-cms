import { expect, test } from '@playwright/test'

import {
  OWNER,
  createAgencyClient,
  login,
  openAgencyPeople,
  uniqueSuffix,
} from './helpers'

/**
 * Taps, not clicks, on a phone. A `touch-target` hit area that is not inside a
 * positioned host covers the viewport and steals these taps.
 */
test.describe('phone taps reach the people controls', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })

  test('status select, row menu, row checkbox and the invite picker all take taps', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000)
    const suffix = uniqueSuffix()
    const names = {
      a: `E2E Touch Alpha ${suffix}`,
      b: `E2E Touch Beta ${suffix}`,
    }

    // Two clients to pick from, made on a desktop page.
    const desktop = await browser.newContext()
    const desk = await desktop.newPage()
    await login(desk)
    const slugA = await createAgencyClient(desk, names.a)
    const slugB = await createAgencyClient(desk, names.b)
    await desktop.close()

    await login(page)
    await openAgencyPeople(page)

    // Status select: tap to open, tap an option.
    await page.getByTestId('people-status-select').tap()
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.getByRole('option', { name: /^Blocked/ }).tap()
    await expect(page.getByTestId('people-status-select')).toContainText(
      'Blocked',
    )
    await page.getByTestId('people-status-select').tap()
    await page.getByRole('option', { name: /^All/ }).tap()

    // Row menu.
    await page.getByTestId(`person-menu-${OWNER}`).tap()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()

    // Row checkbox selects the person and raises the bulk bar.
    await page.getByTestId(`person-select-${OWNER}`).tap()
    await expect(page.getByTestId('people-bulk-bar')).toBeVisible()
    await page.getByTestId('bulk-clear').tap()
    await expect(page.getByTestId('people-bulk-bar')).toHaveCount(0)

    // Invite sheet: pick one client, then open the picker again for a second.
    await page.getByTestId('invite-person').tap()
    const sheet = page.getByTestId('invite-person-sheet')
    await expect(sheet).toBeVisible()
    await page.getByTestId('invite-person-clients-add').tap()
    await page.getByTestId(`client-picker-option-${slugA}`).tap()
    await page.getByTestId('client-picker-add').tap()
    await expect(page.getByTestId(`invite-person-pick-${slugA}`)).toBeVisible()
    // Let the picker finish closing; a tap during its exit lands on the overlay.
    await expect(page.getByTestId('client-picker')).toBeHidden()

    await page.getByTestId('invite-person-clients-add').tap()
    await page.getByTestId(`client-picker-option-${slugB}`).tap()
    await page.getByTestId('client-picker-add').tap()
    await expect(page.getByTestId(`invite-person-pick-${slugB}`)).toBeVisible()

    // Remove one pick with its ✕ (also a touch target), then close without sending.
    await page.getByRole('button', { name: `Remove ${names.b}` }).tap()
    await expect(page.getByTestId(`invite-person-pick-${slugB}`)).toHaveCount(0)
    await page.getByTestId('slide-over-close').tap()
    await expect(sheet).toBeHidden()
  })
})
