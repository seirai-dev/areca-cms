import { createHash, randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

import { ACME_SITE, EDITOR, OWNER, PASSWORD, hydrated } from './helpers'

/**
 * An AI app signing in with OAuth 2.1 (PKCE), the way ChatGPT or Claude does:
 * register, send the user to authorize, sign in, approve on the consent page,
 * exchange the code, then call the site's MCP endpoint with the token.
 * The redirect target is intercepted, so no app needs to listen on it.
 */
const REDIRECT = 'http://localhost:4599/callback'

function base64url(buffer: Buffer) {
  return buffer.toString('base64url')
}

async function registerApp(api: APIRequestContext, baseURL: string) {
  const response = await api.post('/api/auth/oauth2/register', {
    headers: { origin: baseURL },
    data: {
      client_name: 'E2E Assistant',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
    },
  })
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as { client_id: string }
  return body.client_id
}

function authorizeUrl(baseURL: string, clientId: string, verifier: string) {
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const resource = `${baseURL}/api/mcp/${ACME_SITE}`
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'mcp offline_access',
    state: 'e2e-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  })
  return `${baseURL}/api/auth/oauth2/authorize?${params.toString()}`
}

/** Signs in on the login screen that the authorization sent the user to. */
async function signInFromApp(page: Page, email: string) {
  await page.waitForURL(/\/login\?/, { timeout: 30_000 })
  await expect(page.getByTestId('login-form')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 30_000 },
  )
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Visits the authorize URL and returns the browser's redirect (if any). */
async function approveFromApp(
  page: Page,
  request: APIRequestContext,
  baseURL: string,
  options: { email: string; goLive: boolean },
) {
  const verifier = base64url(randomBytes(48))
  const clientId = await registerApp(request, baseURL)
  let redirected: string | null = null
  await page.route(`${REDIRECT.replace('/callback', '')}/**`, (route) => {
    redirected = route.request().url()
    return route.fulfill({ status: 200, body: 'ok' })
  })
  await page.goto(authorizeUrl(baseURL, clientId, verifier))
  await signInFromApp(page, options.email)
  await page.waitForURL(/\/oauth\/consent\?/, { timeout: 30_000 })
  await expect(page.getByTestId('oauth-consent')).toHaveAttribute(
    'data-ready',
    'true',
    { timeout: 30_000 },
  )
  return { clientId, verifier, redirected: () => redirected }
}

test.describe('AI app sign-in (OAuth consent)', () => {
  test('owner approves with go-live, and the app can call the site', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3000'
    const app = await approveFromApp(page, request, origin, {
      email: OWNER,
      goLive: true,
    })
    await expect(page.getByTestId('oauth-consent-can')).toContainText(
      'Mark entries ready',
    )
    await expect(page.getByTestId('oauth-consent-host')).toContainText(
      'localhost:4599',
    )
    await page.screenshot({
      path: test.info().outputPath('consent-owner.png'),
      fullPage: true,
    })
    await page.getByTestId('oauth-consent-go-live').click()
    await expect(page.getByTestId('oauth-consent-go-live')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await page.getByTestId('oauth-consent-allow').click()

    await expect
      .poll(() => app.redirected(), { timeout: 30_000 })
      .not.toBeNull()
    const callback = new URL(app.redirected() as string)
    expect(callback.searchParams.get('state')).toBe('e2e-state')
    const code = callback.searchParams.get('code')
    expect(code).toBeTruthy()

    const token = await request.post(`${origin}/api/auth/oauth2/token`, {
      form: {
        grant_type: 'authorization_code',
        code: code ?? '',
        redirect_uri: REDIRECT,
        client_id: app.clientId,
        code_verifier: app.verifier,
        resource: `${origin}/api/mcp/${ACME_SITE}`,
      },
    })
    expect(token.ok()).toBe(true)
    const { access_token: accessToken } = (await token.json()) as {
      access_token: string
    }

    const tools = await listTools(request, origin, accessToken)
    expect(tools).toContain('go_live')
    expect(tools).toContain('mark_ready')
  })

  test('editor approves without go-live and gets fewer tools', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3000'
    const app = await approveFromApp(page, request, origin, {
      email: EDITOR,
      goLive: false,
    })
    await expect(page.getByTestId('oauth-consent-go-live')).toHaveCount(0)
    await expect(page.getByText('(Editor)')).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('consent-editor.png'),
      fullPage: true,
    })
    await page.getByTestId('oauth-consent-allow').click()
    await expect
      .poll(() => app.redirected(), { timeout: 30_000 })
      .not.toBeNull()

    const code = new URL(app.redirected() as string).searchParams.get('code')
    const token = await request.post(`${origin}/api/auth/oauth2/token`, {
      form: {
        grant_type: 'authorization_code',
        code: code ?? '',
        redirect_uri: REDIRECT,
        client_id: app.clientId,
        code_verifier: app.verifier,
        resource: `${origin}/api/mcp/${ACME_SITE}`,
      },
    })
    const { access_token: accessToken } = (await token.json()) as {
      access_token: string
    }
    const tools = await listTools(request, origin, accessToken)
    expect(tools).toContain('create_entry')
    expect(tools).not.toContain('go_live')
    expect(tools).not.toContain('mark_ready')
  })

  test('cancel sends the app access_denied', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3000'
    const app = await approveFromApp(page, request, origin, {
      email: OWNER,
      goLive: false,
    })
    await page.getByTestId('oauth-consent-cancel').click()
    await expect
      .poll(() => app.redirected(), { timeout: 30_000 })
      .not.toBeNull()
    const callback = new URL(app.redirected() as string)
    expect(callback.searchParams.get('error')).toBe('access_denied')
    expect(callback.searchParams.get('code')).toBeNull()
  })

  test('a tampered link explains itself and offers no approval', async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3000'
    await page.goto(
      `${origin}/oauth/consent?response_type=code&client_id=nope&exp=1&sig=bad`,
    )
    await hydrated(page, page.getByRole('heading', { level: 1 }))
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      "can't be used",
    )
    await expect(page.getByTestId('oauth-consent-allow')).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath('consent-invalid.png'),
      fullPage: true,
    })
  })

  test('signed out, the consent page sends you to sign in first', async ({
    browser,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3000'
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    const clientId = await registerApp(context.request, origin)
    // A real, signed authorization query, taken from the login redirect.
    await page.goto(authorizeUrl(origin, clientId, base64url(randomBytes(48))))
    await page.waitForURL(/\/login\?/, { timeout: 30_000 })
    const query = new URL(page.url()).search
    await page.goto(`${origin}/oauth/consent${query}`)
    await expect(page).toHaveURL(/\/login\?response_type=code/, {
      timeout: 30_000,
    })
    await context.close()
  })
})

/** Calls tools/list on the site endpoint: initialize first, then the list. */
async function listTools(
  request: APIRequestContext,
  origin: string,
  accessToken: string,
): Promise<string[]> {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json, text/event-stream',
  }
  const url = `${origin}/api/mcp/${ACME_SITE}`
  const init = await request.post(url, {
    headers,
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    },
  })
  expect(init.status()).toBe(200)
  const session = init.headers()['mcp-session-id']
  const list = await request.post(url, {
    headers: session ? { ...headers, 'mcp-session-id': session } : headers,
    data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  })
  expect(list.status()).toBe(200)
  const text = await list.text()
  return [...text.matchAll(/"name":"([a-z_]+)"/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  )
}
