import { createHash, randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ADMIN,
  OWNER,
  PASSWORD,
  hydrated,
  login,
  openAgency,
  uniqueSuffix,
} from './helpers'

/** Opens Agency › Connect AI from the sidebar and waits for the address. */
async function openAgencyConnectAi(page: Page) {
  await openAgency(page)
  const nav = page
    .getByTestId('agency-connect-ai-nav')
    .filter({ visible: true })
    .first()
  await expect(nav).toBeVisible({ timeout: 30_000 })
  await nav.click()
  await expect(page).toHaveURL(/\/agency\/connect-ai$/)
  await expect(page.getByTestId('agency-connect-ai')).toBeVisible()
  await hydrated(page, page.getByTestId('agency-connect-ai'))
  await expect(page.getByTestId('connect-ai-endpoint')).toContainText(
    '/api/agency/mcp',
  )
}

test.describe('Agency › Connect AI', () => {
  test('agency admin sees the connector address, app guides and the nav link', async ({
    page,
  }) => {
    await login(page, ADMIN, PASSWORD)
    await openAgencyConnectAi(page)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Connect AI',
    )
    await expect(page.getByTestId('connect-ai-url-copy')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Connect an app', exact: true }),
    ).toBeVisible()
    await page.getByTestId('connect-ai-guide-tab-claude-code').click()
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      'claude mcp add --transport http areca-agency',
    )
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      '/api/agency/mcp',
    )
    await expect(page.getByTestId('connect-ai-command')).not.toContainText(
      'Authorization',
    )
  })

  test('creates a key with an expiry, shows it once, lists it and revokes it', async ({
    page,
  }) => {
    await login(page, ADMIN, PASSWORD)
    await openAgencyConnectAi(page)

    const name = `E2E agency ${uniqueSuffix()}`
    await page.getByTestId('connect-ai-create').click()
    const dialog = page.getByTestId('connect-ai-create-dialog')
    await expect(dialog).toBeVisible()
    // No go-live switch on an agency key. Agency credentials can always go live (allowGoLive is true for agency actors), so there is no tick to offer.
    await expect(page.getByTestId('connect-ai-go-live')).toHaveCount(0)
    await page.getByTestId('connect-ai-name').fill(name)
    await page.getByTestId('connect-ai-expiry-30').click()
    await page.getByTestId('connect-ai-create-submit').click()

    // The seeded admin has no two-factor, so the step-up passes straight away.
    await expect(page.getByTestId('connect-ai-warning')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('connect-ai-key')).toContainText('areca_mcp_')
    await expect(page.getByTestId('connect-ai-copy-key')).toBeVisible()
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      'Authorization: Bearer areca_mcp_',
    )
    await expect(page.getByTestId('connect-ai-command')).toContainText(
      'areca-agency',
    )
    await page.getByTestId('connect-ai-done').click()
    await expect(dialog).toBeHidden()

    // Shown once: the key is gone from the page after the dialog closes.
    await expect(page.getByTestId('connect-ai-key')).toHaveCount(0)

    const row = page
      .getByTestId('connect-ai-keys')
      .locator('li', { hasText: name })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText('Never used')
    await expect(row).toContainText('Expires')
    await expect(row).not.toContainText('Can go live')

    await row.getByTestId('connect-ai-revoke').click()
    await page.getByTestId('confirm-action').click()
    await expect(row).toHaveCount(0, { timeout: 30_000 })
  })

  test('an agency app approves on the consent screen, is listed and can be disconnected', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3000'
    const redirect = 'http://localhost:4599/callback'
    const appName = `E2E agency app ${uniqueSuffix()}`
    await login(page, ADMIN, PASSWORD)

    const registered = await request.post(
      `${origin}/api/auth/oauth2/register`,
      {
        headers: { origin },
        data: {
          client_name: appName,
          redirect_uris: [redirect],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          application_type: 'native',
        },
      },
    )
    expect(registered.ok()).toBe(true)
    const { client_id: clientId } = (await registered.json()) as {
      client_id: string
    }
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      scope: 'mcp offline_access',
      state: 'agency-e2e',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${origin}/api/agency/mcp`,
    })
    await page.route('http://localhost:4599/**', (route) =>
      route.fulfill({ status: 200, body: 'ok' }),
    )
    await page.goto(`${origin}/api/auth/oauth2/authorize?${params.toString()}`)

    await page.waitForURL(/\/oauth\/consent\?/, { timeout: 30_000 })
    const consent = page.getByTestId('oauth-consent')
    await expect(consent).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    })
    await expect(consent).toHaveAttribute('data-variant', 'agency')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Connect',
    )
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'to every client',
    )
    await expect(page.getByTestId('oauth-consent-warning')).toContainText(
      'including production',
    )
    await expect(page.getByTestId('oauth-consent-go-live')).toHaveCount(0)
    await page.getByTestId('oauth-consent-allow').click()

    // Approved: the app's redirect carries the code, and the app is listed.
    await page.waitForURL(/localhost:4599\/callback/, { timeout: 30_000 })
    // The redirect target is not the CMS, so go back to the page directly.
    await page.goto('/agency/connect-ai')
    await hydrated(page, page.getByTestId('agency-connect-ai'))
    const connected = page
      .getByTestId('connect-ai-connected')
      .locator('li', { hasText: appName })
    await expect(connected).toBeVisible({ timeout: 30_000 })
    await expect(connected).toContainText('Never used')

    await connected.getByTestId('connect-ai-disconnect').click()
    await page.getByTestId('confirm-action').click()
    await expect(connected).toHaveCount(0, { timeout: 30_000 })
  })

  test('a client owner cannot reach the agency connector', async ({ page }) => {
    await login(page, OWNER, PASSWORD)
    await page.goto('/agency/connect-ai')
    await page.waitForURL((url) => !url.pathname.startsWith('/agency'), {
      timeout: 30_000,
    })
    await expect(page.getByTestId('agency-connect-ai')).toHaveCount(0)
    await expect(page.getByTestId('agency-connect-ai-nav')).toHaveCount(0)
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the page stacks and does not scroll sideways', async ({ page }) => {
      await login(page, ADMIN, PASSWORD)
      await page.goto('/agency/connect-ai')
      await hydrated(page, page.getByTestId('agency-connect-ai'))

      await expect(page.getByTestId('connect-ai-url-copy')).toBeVisible({
        timeout: 30_000,
      })
      const box = await page.getByTestId('connect-ai-url-copy').boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true)
      await expect(page.getByTestId('connect-ai-guide-tab-cursor')).toBeHidden()
      await page.getByTestId('connect-ai-guide-picker').click()
      await page.getByRole('option', { name: 'Cursor' }).click()
      await expect(page.getByTestId('connect-ai-add-cursor')).toBeVisible()
    })
  })
})
