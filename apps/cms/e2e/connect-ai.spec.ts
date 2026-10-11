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

/** Personal keys live under "Advanced", collapsed by default. */
async function openAdvanced(page: Page) {
  const advanced = page.getByTestId('connect-ai-advanced')
  await advanced.locator('summary').click()
  await expect(advanced).toHaveAttribute('open', '')
}

test.describe('Connect AI', () => {
  test('shows one connector URL and a guide for each AI app', async ({
    page,
  }) => {
    await login(page, OWNER, PASSWORD)
    await openSite(page, ACME_SITE)
    await openConnectAi(page)

    const panel = page.getByTestId('connect-ai-url-panel')
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('connect-ai-endpoint')).toContainText(
      '/api/mcp/acme-site',
    )
    await expect(page.getByTestId('connect-ai-url-copy')).toBeVisible()

    // Desktop: tabs per app. The Claude Code guide carries the command.
    await page.getByTestId('connect-ai-guide-tab-claude-code').click()
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      'claude mcp add --transport http areca-acme-site',
    )
    await expect(page.getByTestId('connect-ai-command')).not.toContainText(
      'Authorization',
    )
    await page.getByTestId('connect-ai-guide-tab-cursor').click()
    await expect(page.getByTestId('connect-ai-add-cursor')).toHaveAttribute(
      'href',
      /^cursor:\/\/anysphere\.cursor-deeplink/,
    )
    await page.screenshot({
      path: test.info().outputPath('connect-ai-desktop.png'),
      fullPage: true,
    })
  })

  test('owner creates an advanced key, sees it once, and revokes it', async ({
    page,
  }) => {
    await login(page, OWNER, PASSWORD)
    await openSite(page, ACME_SITE)
    await openConnectAi(page)
    // Connected apps (OAuth) are listed above the advanced section.
    await expect(
      page
        .getByTestId('connect-ai-connected-empty')
        .or(page.getByTestId('connect-ai-connected')),
    ).toBeVisible({ timeout: 30_000 })

    // The advanced key flow still works for scripts.
    await openAdvanced(page)
    const name = `E2E Claude ${uniqueSuffix()}`
    await page.getByTestId('connect-ai-create').click()
    const dialog = page.getByTestId('connect-ai-create-dialog')
    await expect(dialog).toBeVisible()
    await page.getByTestId('connect-ai-name').fill(name)
    await page.getByTestId('connect-ai-expiry-never').click()
    const goLive = page.getByTestId('connect-ai-go-live')
    await expect(goLive).toBeVisible()
    await goLive.click()
    await expect(goLive).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('connect-ai-create-submit').click()

    await expect(page.getByTestId('connect-ai-warning')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('connect-ai-key')).toContainText('areca_mcp_')
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      'Authorization: Bearer areca_mcp_',
    )
    await page.getByTestId('connect-ai-done').click()
    await expect(dialog).toBeHidden()

    const row = page
      .getByTestId('connect-ai-keys')
      .locator('li', { hasText: name })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Can go live')
    await expect(row).toContainText('Never used')
    await expect(row).toContainText('Never expires')
    await expect(page.getByTestId('connect-ai-role-note')).toContainText(
      'Scheduling and publishing need an app or key allowed to go live',
    )
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
    await openAdvanced(page)
    await page.getByTestId('connect-ai-create').click()
    await expect(page.getByTestId('connect-ai-create-dialog')).toBeVisible()
    await expect(page.getByTestId('connect-ai-name')).toBeVisible()
    await expect(page.getByTestId('connect-ai-go-live')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('connect-ai-create-dialog')).toBeHidden()
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 } })

    test('the page fits the screen and the app guide is a menu', async ({
      page,
    }) => {
      await login(page, OWNER, PASSWORD)
      await openSite(page, ACME_SITE)
      const siteId = siteIdFromUrl(page)
      await page.goto(`/sites/${siteId}/connect-ai`)
      await hydrated(page, page.getByTestId('connect-ai'))

      await expect(page.getByTestId('connect-ai-url-copy')).toBeVisible({
        timeout: 30_000,
      })
      const copy = page.getByTestId('connect-ai-url-copy')
      const box = await copy.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true)

      // Narrow screens pick the app from a menu instead of a tab strip.
      await expect(page.getByTestId('connect-ai-guide-tab-cursor')).toBeHidden()
      await page.getByTestId('connect-ai-guide-picker').click()
      await page.getByRole('option', { name: 'Cursor' }).click()
      await expect(page.getByTestId('connect-ai-add-cursor')).toBeVisible()
      await page.screenshot({
        path: test.info().outputPath('connect-ai-375.png'),
        fullPage: true,
      })
    })
  })
})
