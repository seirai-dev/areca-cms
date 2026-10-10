import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ACME_SITE,
  EDITOR,
  OWNER,
  PASSWORD,
  hydrated,
  login,
  openSite,
  siteIdFromUrl,
  uniqueSuffix,
} from './helpers'

/** Opens Connect AI from the sidebar (every member has it). */
async function openConnectAi(page: Page) {
  const nav = page
    .getByTestId('connect-ai-nav')
    .filter({ visible: true })
    .first()
  await expect(nav).toBeVisible({ timeout: 30_000 })
  await nav.click()
  await expect(page).toHaveURL(/\/connect-ai$/)
  await expect(page.getByTestId('connect-ai')).toBeVisible()
  await hydrated(page, page.getByTestId('connect-ai'))
}

test.describe('Connect AI', () => {
  test('owner creates a key, sees it once, and revokes it', async ({
    page,
  }) => {
    await login(page, OWNER, PASSWORD)
    await openSite(page, ACME_SITE)
    await openConnectAi(page)

    const name = `E2E Claude ${uniqueSuffix()}`
    await page.getByTestId('connect-ai-create').click()
    const dialog = page.getByTestId('connect-ai-create-dialog')
    await expect(dialog).toBeVisible()

    await page.getByTestId('connect-ai-name').fill(name)
    // Owners may tick "Allow going live".
    const goLive = page.getByTestId('connect-ai-go-live')
    await expect(goLive).toBeVisible()
    await goLive.click()
    await expect(goLive).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('connect-ai-create-submit').click()

    // The reveal: the warning, the real key and the Claude Code command.
    await expect(page.getByTestId('connect-ai-warning')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('connect-ai-key')).toContainText('areca_mcp_')
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      'claude mcp add --transport http areca-acme-site',
    )
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      'Authorization: Bearer areca_mcp_',
    )
    await page.screenshot({
      path: test.info().outputPath('connect-ai-reveal.png'),
    })

    await page.getByTestId('connect-ai-done').click()
    await expect(dialog).toBeHidden()

    const row = page
      .getByTestId('connect-ai-keys')
      .locator('li', { hasText: name })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Can go live')
    await expect(row).toContainText('Never used')
    await expect(page.getByTestId('connect-ai-role-note')).toContainText(
      'delete and restore entries',
    )
    await page.screenshot({
      path: test.info().outputPath('connect-ai-page.png'),
      fullPage: true,
    })

    await row.getByTestId('connect-ai-revoke').click()
    await page.getByTestId('confirm-action').click()
    await expect(row).toHaveCount(0, { timeout: 30_000 })
  })

  test('editor gets a key without the go-live switch', async ({ page }) => {
    await login(page, EDITOR, PASSWORD)
    await openSite(page, ACME_SITE)
    await openConnectAi(page)

    await expect(page.getByTestId('connect-ai-role-note')).toContainText(
      'Only an owner can mark a post ready or publish it',
    )
    await page.getByTestId('connect-ai-create').click()
    await expect(page.getByTestId('connect-ai-create-dialog')).toBeVisible()
    await expect(page.getByTestId('connect-ai-name')).toBeVisible()
    await expect(page.getByTestId('connect-ai-go-live')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('connect-ai-create-dialog')).toBeHidden()
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 } })

    test('the page and reveal fit the screen with touch-sized buttons', async ({
      page,
    }) => {
      await login(page, OWNER, PASSWORD)
      await openSite(page, ACME_SITE)
      const siteId = siteIdFromUrl(page)
      await page.goto(`/sites/${siteId}/connect-ai`)
      await hydrated(page, page.getByTestId('connect-ai'))

      const create = page.getByTestId('connect-ai-create')
      await expect(create).toBeVisible({ timeout: 30_000 })
      const box = await create.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true)

      await create.click()
      await page.getByTestId('connect-ai-name').fill('Phone key')
      await page.getByTestId('connect-ai-create-submit').click()
      await expect(page.getByTestId('connect-ai-key')).toContainText(
        'areca_mcp_',
        { timeout: 30_000 },
      )
      // Narrow screens pick the app from a menu instead of a tab strip.
      await expect(page.getByTestId('connect-ai-tab-cursor')).toBeHidden()
      await page.getByTestId('connect-ai-app-picker').click()
      await page.getByRole('option', { name: 'Cursor' }).click()
      await expect(page.getByTestId('connect-ai-add-cursor')).toBeVisible()
      await page.screenshot({
        path: test.info().outputPath('connect-ai-mobile-reveal.png'),
      })
      await page.getByTestId('connect-ai-done').click()
      await expect(page.getByTestId('connect-ai-create-dialog')).toBeHidden()

      const row = page
        .getByTestId('connect-ai-keys')
        .locator('li', { hasText: 'Phone key' })
      await row.getByTestId('connect-ai-revoke').click()
      await page.getByTestId('confirm-action').click()
      await expect(row).toHaveCount(0, { timeout: 30_000 })
    })
  })
})
