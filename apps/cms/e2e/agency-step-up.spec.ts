import { createHash, randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Browser, Page } from '@playwright/test'
import { Pool } from 'pg'

import {
  ADMIN,
  PASSWORD,
  hydrated,
  login,
  totpCode,
  uniqueSuffix,
} from './helpers'

/*
 * Step-up (re-authentication with an authenticator code) for the two agency
 * actions that need a fresh second factor: creating an agency personal key and
 * approving an agency OAuth app. The seeded admin has no two-factor, so these
 * tests create their own agency admin with two-factor enrolled.
 *
 * Freshness: with ADMIN_MFA_REQUIRED off, a session counts as fresh for ten
 * minutes after it was created or re-verified (server/security/step-up.ts). The
 * tests age the session's created_at in the database just before the action,
 * so the step-up dialog appears without waiting ten minutes.
 */

const CONNECT_AI = '/agency/connect-ai'

async function withDb<T>(run: (pool: Pool) => Promise<T>) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    return await run(pool)
  } finally {
    await pool.end()
  }
}

/**
 * Creates an agency admin that signs in with the shared test password (the
 * same credential row as the seeded admin), then enrols two-factor on
 * /account. Leaves the browser signed in as that admin.
 */
async function enrolAgencyAdmin(browser: Browser) {
  const email = `mfa-agency+${uniqueSuffix()}@example.com`
  await withDb(async (pool) => {
    const userId = crypto.randomUUID()
    await pool.query(
      `insert into "user" (id, name, email, email_verified, is_agency_admin)
       values ($1, 'E2E MFA agency admin', $2, true, true)`,
      [userId, email],
    )
    const copied = await pool.query(
      `insert into account (id, account_id, provider_id, user_id, password)
       select $1, $2, 'credential', $2, a.password
       from account a
       join "user" u on u.id = a.user_id
       where u.email = $3 and a.provider_id = 'credential'`,
      [crypto.randomUUID(), userId, ADMIN],
    )
    expect(copied.rowCount).toBe(1)
  })

  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await login(page, email, PASSWORD)
  await page.goto('/account')
  await expect(page.getByTestId('two-factor-section')).toBeVisible()
  await hydrated(page, page.getByTestId('two-factor-section'))
  await page.getByTestId('two-factor-enable').click()
  await page.locator('#two-factor-password').fill(PASSWORD)
  await page
    .getByTestId('two-factor-password')
    .locator('button[type="submit"]')
    .click()
  await expect(page.getByTestId('two-factor-qr').locator('svg')).toBeVisible()
  const secret =
    (await page.getByTestId('two-factor-secret').textContent())?.trim() ?? ''
  expect(secret).not.toBe('')
  await page.locator('#two-factor-enrol-code').fill(totpCode(secret))
  await page
    .getByTestId('two-factor-verify')
    .locator('button[type="submit"]')
    .click()
  await expect(page.getByTestId('two-factor-codes')).toBeVisible()
  await page.getByTestId('two-factor-done').click()

  return { context, page, email, secret }
}

/** Ages the admin's session past the ten-minute step-up window. */
async function makeSessionStale(email: string) {
  await withDb(async (pool) => {
    const result = await pool.query(
      `update session set created_at = now() - interval '1 hour'
       where user_id = (select id from "user" where email = $1)`,
      [email],
    )
    expect(result.rowCount).toBeGreaterThan(0)
  })
}

async function countAgencyKeys(email: string, name: string) {
  return withDb(async (pool) => {
    const result = await pool.query(
      `select count(*)::int as n from mcp_key k
       join "user" u on u.id = k.user_id
       where u.email = $1 and k.name = $2 and k.scope = 'agency'`,
      [email, name],
    )
    return result.rows[0].n as number
  })
}

async function countAgencyConnections(email: string, clientName: string) {
  return withDb(async (pool) => {
    const result = await pool.query(
      `select count(*)::int as n from mcp_connection c
       join "user" u on u.id = c.user_id
       where u.email = $1 and c.client_name = $2 and c.scope = 'agency'
         and c.revoked_at is null`,
      [email, clientName],
    )
    return result.rows[0].n as number
  })
}

/** A code one step away from the right one: never accepted. */
function wrongCode(secret: string) {
  return String((Number(totpCode(secret)) + 1) % 1_000_000).padStart(6, '0')
}

async function openConnectAi(page: Page) {
  await page.goto(CONNECT_AI)
  await hydrated(page, page.getByTestId('agency-connect-ai'))
  await expect(page.getByTestId('connect-ai-endpoint')).toContainText(
    '/api/agency/mcp',
  )
}

/** Opens the create dialog, fills it and submits, which reaches the step-up. */
async function submitNewAgencyKey(page: Page, name: string) {
  await page.getByTestId('connect-ai-create').click()
  await expect(page.getByTestId('connect-ai-create-dialog')).toBeVisible()
  await page.getByTestId('connect-ai-name').fill(name)
  await page.getByTestId('connect-ai-expiry-30').click()
  await page.getByTestId('connect-ai-create-submit').click()
}

test.describe('Agency step-up with two-factor', () => {
  // Serial: concurrent /account loads by agency admins can deadlock in the
  // server's self-delete check (countActiveAgencyAdmins locks every agency
  // admin row FOR UPDATE), which fails the enrolment step.
  test.describe.configure({ mode: 'serial' })

  test('cancelling the code prompt creates no agency key', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const admin = await enrolAgencyAdmin(browser)
    try {
      const { page, email } = admin
      await openConnectAi(page)
      const rows = page.getByTestId('connect-ai-keys').locator('li')
      const before = await rows.count()

      await makeSessionStale(email)
      const name = `E2E step-up cancel ${uniqueSuffix()}`
      await submitNewAgencyKey(page, name)

      const dialog = page.getByTestId('step-up-dialog')
      await expect(dialog).toBeVisible({ timeout: 30_000 })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()

      // The create request has settled once its submit is usable again.
      await expect(page.getByTestId('connect-ai-create-submit')).toBeEnabled({
        timeout: 30_000,
      })
      expect(await countAgencyKeys(email, name)).toBe(0)
      await expect(page.getByTestId('connect-ai-key')).toHaveCount(0)
      await expect(rows).toHaveCount(before)
    } finally {
      await admin.context.close()
    }
  })

  test('a wrong code is refused, the right one reveals the key once and it is listed once', async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const admin = await enrolAgencyAdmin(browser)
    try {
      const { page, email, secret } = admin
      await openConnectAi(page)

      await makeSessionStale(email)
      const name = `E2E step-up code ${uniqueSuffix()}`
      await submitNewAgencyKey(page, name)

      const dialog = page.getByTestId('step-up-dialog')
      await expect(dialog).toBeVisible({ timeout: 30_000 })
      await dialog.locator('#step-up-code').fill(wrongCode(secret))
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
      await expect(dialog.getByRole('alert')).toContainText(
        'That code did not work',
        { timeout: 30_000 },
      )
      await expect(dialog).toBeVisible()
      expect(await countAgencyKeys(email, name)).toBe(0)

      await dialog.locator('#step-up-code').fill(totpCode(secret))
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })

      // Revealed once, with the key itself.
      await expect(page.getByTestId('connect-ai-warning')).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByTestId('connect-ai-key')).toContainText(
        'areca_mcp_',
      )
      await page.getByTestId('connect-ai-done').click()
      await expect(page.getByTestId('connect-ai-key')).toHaveCount(0)

      // Exactly one row and one stored key: the retry did not duplicate it.
      const row = page
        .getByTestId('connect-ai-keys')
        .locator('li', { hasText: name })
      await expect(row).toHaveCount(1, { timeout: 30_000 })
      await expect
        .poll(() => countAgencyKeys(email, name), { timeout: 30_000 })
        .toBe(1)
    } finally {
      await admin.context.close()
    }
  })

  test('approving an agency app asks for the code, then connects it once', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const origin = baseURL ?? 'http://localhost:3000'
    const redirect = 'http://localhost:4599/callback'
    const appName = `E2E step-up app ${uniqueSuffix()}`
    const admin = await enrolAgencyAdmin(browser)
    try {
      const { page, email, secret } = admin
      await startConsent(page, request, origin, redirect, appName)

      const consent = page.getByTestId('oauth-consent')
      await expect(consent).toHaveAttribute('data-ready', 'true', {
        timeout: 30_000,
      })
      await expect(consent).toHaveAttribute('data-variant', 'agency')

      await makeSessionStale(email)
      await page.getByTestId('oauth-consent-allow').click()

      const dialog = page.getByTestId('step-up-dialog')
      await expect(dialog).toBeVisible({ timeout: 30_000 })
      await expect(page).toHaveURL(/\/oauth\/consent\?/)
      await dialog.locator('#step-up-code').fill(totpCode(secret))
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()

      await page.waitForURL(/localhost:4599\/callback/, { timeout: 30_000 })
      await openConnectAi(page)
      const connected = page
        .getByTestId('connect-ai-connected')
        .locator('li', { hasText: appName })
      await expect(connected).toHaveCount(1, { timeout: 30_000 })
      await expect
        .poll(() => countAgencyConnections(email, appName), {
          timeout: 30_000,
        })
        .toBe(1)
    } finally {
      await admin.context.close()
    }
  })
})

/**
 * Registers a native app, then opens its agency consent request (scope and
 * resource as the agency connector asks for). Mirrors agency-connect-ai.spec.ts.
 */
async function startConsent(
  page: Page,
  request: APIRequestContext,
  origin: string,
  redirect: string,
  appName: string,
) {
  const registered = await request.post(`${origin}/api/auth/oauth2/register`, {
    headers: { origin },
    data: {
      client_name: appName,
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
    },
  })
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
    state: 'agency-step-up-e2e',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${origin}/api/agency/mcp`,
  })
  await page.route('http://localhost:4599/**', (route) =>
    route.fulfill({ status: 200, body: 'ok' }),
  )
  await page.goto(`${origin}/api/auth/oauth2/authorize?${params.toString()}`)
  await page.waitForURL(/\/oauth\/consent\?/, { timeout: 30_000 })
}
