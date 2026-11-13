/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups are checked defensively */
import { createHash, createHmac, randomBytes } from 'node:crypto'

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { hashPassword, symmetricEncrypt } from 'better-auth/crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as StartServer from '@tanstack/react-start/server'

import { db } from '#/db'
import {
  account,
  mcpConnection,
  membership,
  oauthClient,
  oauthResource,
  session,
  twoFactor,
  user,
  verification,
} from '#/db/schema'
import { env } from '#/env'
import { auth } from '#/lib/auth'
import { MfaRequiredError, ReauthRequiredError } from '#/lib/security-errors'
import { setAgencyAdmin } from '#/server/admin/agency-admins'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'
import { recordStepUp } from '#/server/security/step-up'

import { handleAgencyMcpRequest } from './agency-http'
import {
  approveAgencyConsentRequest,
  approveConsentRequest,
  describeConsentRequest,
} from './consent'
import { listAgencyConnections, revokeAgencyConnection } from './connections'
import { handleDiscoveryRequest } from './discovery'
import { handleSiteMcpRequest, protectedResourceMetadataUrlFor } from './http'
import { agencyMcpResourceUrl, mcpResourceUrl } from './oauth-resource'

vi.hoisted(() => {
  process.env.ADMIN_MFA_REQUIRED = 'true'
  process.env.AUTH_EMAIL_PASSWORD_ENABLED = 'true'
  process.env.WORKER_ENABLED = 'false'
})

// The consent functions read the signed-in session from request headers. Tests
// set the cookie jar of the user acting, exactly as the browser would send it.
const requestState = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof StartServer>()),
  getRequestHeaders: () => requestState.headers,
}))

const hasDb = Boolean(process.env.DATABASE_URL)
const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)
  } catch {
    return ''
  }
})()
// Same rule as the other authorization suites: never run against a developer database.
const runnable = hasDb && /authz|test|e2e|bench|tmp/i.test(dbName)

const AUTH_ORIGIN = new URL(env.BETTER_AUTH_URL).origin
const AUTH_BASE = `${AUTH_ORIGIN}/api/auth`
const REDIRECT_URI = 'http://localhost:9999/callback'
const PASSWORD = 'Correct-horse-battery-1'
const TOTP_SECRET = 'areca-test-totp-secret-agency-0123'
const AGENCY_URL = agencyMcpResourceUrl()

type Jar = Map<string, string>

function absorbCookies(jar: Jar, response: Response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair = ''] = raw.split(';')
    const at = pair.indexOf('=')
    if (at < 0) continue
    const name = pair.slice(0, at).trim()
    const value = pair.slice(at + 1).trim()
    if (!value || /max-age=0|1970/i.test(raw)) jar.delete(name)
    else jar.set(name, value)
  }
}

function cookieHeader(jar: Jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function authPost(
  path: string,
  body: unknown,
  jar: Jar = new Map(),
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json',
    origin: AUTH_ORIGIN,
  })
  if (jar.size > 0) headers.set('cookie', cookieHeader(jar))
  const response = await auth.handler(
    new Request(`${AUTH_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
  absorbCookies(jar, response)
  const text = await response.text()
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  }
}

async function tokenRequest(params: Record<string, string>) {
  const response = await auth.handler(
    new Request(`${AUTH_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }),
  )
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  }
}

/** RFC 6238 code for the test secret, as an authenticator app would show. */
function totpNow(secret: string, at = Date.now()) {
  const counter = Math.floor(at / 30_000)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(message).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const binary =
    ((digest[offset] ?? 0) & 0x7f) * 2 ** 24 +
    ((digest[offset + 1] ?? 0) & 0xff) * 2 ** 16 +
    ((digest[offset + 2] ?? 0) & 0xff) * 2 ** 8 +
    ((digest[offset + 3] ?? 0) & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/** The signed login query the plugin appends when it sends a user to /login. */
async function startAuthorization(input: {
  clientId: string
  resource: string
  challenge: string
  state: string
}): Promise<string> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    scope: 'mcp offline_access openid',
    resource: input.resource,
  })
  const response = await auth.handler(
    new Request(`${AUTH_BASE}/oauth2/authorize?${params}`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    }),
  )
  const location = response.headers.get('location') ?? ''
  expect(response.status).toBe(302)
  expect(location).toContain('/login?')
  return new URL(location, AUTH_ORIGIN).search.slice(1)
}

function cookiesAsHeaders(jar: Jar) {
  requestState.headers = new Headers({ cookie: cookieHeader(jar) })
}

/** An app's request in progress: its PKCE pair and the resource it asked for. */
type Flow = {
  clientId: string
  resource: string
  pkce: ReturnType<typeof pkcePair>
  consentQuery: string
  jar: Jar
}

/**
 * Starts an authorization request for `resource` and signs the user in (with
 * a TOTP step when the account has two-factor). Returns the signed consent
 * query the approval screen would receive.
 */
async function signInForConsent(input: {
  clientId: string
  resource: string
  email: string
  twoFactor: boolean
}): Promise<Flow> {
  const pkce = pkcePair()
  const loginQuery = await startAuthorization({
    clientId: input.clientId,
    resource: input.resource,
    challenge: pkce.challenge,
    state: randomBytes(6).toString('hex'),
  })
  const jar: Jar = new Map()
  const signIn = await authPost(
    '/sign-in/email',
    { email: input.email, password: PASSWORD, oauth_query: loginQuery },
    jar,
  )
  expect(signIn.status).toBe(200)
  let next = String(signIn.json.url ?? '')
  if (input.twoFactor) {
    expect(signIn.json.twoFactorRedirect).toBe(true)
    const verified = await authPost(
      '/two-factor/verify-totp',
      { code: totpNow(TOTP_SECRET) },
      jar,
    )
    expect(verified.status).toBe(200)
    const resumed = await authPost(
      '/oauth2/continue',
      { postLogin: true, oauth_query: loginQuery },
      jar,
    )
    expect(resumed.status).toBe(200)
    next = String(resumed.json.url ?? '')
  }
  expect(next).toContain('/oauth/consent?')
  return {
    clientId: input.clientId,
    resource: input.resource,
    pkce,
    consentQuery: new URL(next, AUTH_ORIGIN).search.slice(1),
    jar,
  }
}

/** Exchanges the code in an approval's redirect for tokens, as the app does. */
async function exchange(flow: Flow, redirectTo: string) {
  const code = new URL(redirectTo).searchParams.get('code') ?? ''
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: flow.clientId,
    code_verifier: flow.pkce.verifier,
    resource: flow.resource,
  })
}

function pingRequest(url: string, token?: string) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  })
}

async function agencyClient(token: string) {
  const client = new Client({ name: 'agency-oauth-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(AGENCY_URL), {
    fetch: (input, init) => handleAgencyMcpRequest(new Request(input, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

describe.skipIf(!runnable)(
  'agency connector OAuth (docs/design/agency-mcp.md)',
  () => {
    let ctx: Awaited<ReturnType<typeof createTestSite>>
    let admin: { id: string; email: string }
    let leaver: { id: string; email: string }
    let adminNoMfa: { id: string; email: string }
    let siteOwner: { id: string; email: string }
    const createdUsers: string[] = []
    const clientIds: string[] = []

    async function makeUser(
      label: string,
      options: { agencyAdmin?: boolean; twoFactor?: boolean } = {},
    ) {
      const id = crypto.randomUUID()
      const email = `${label}-${id}@agency-oauth.test`
      createdUsers.push(id)
      await db.insert(user).values({
        id,
        name: label,
        email,
        emailVerified: true,
        isAgencyAdmin: Boolean(options.agencyAdmin),
        twoFactorEnabled: Boolean(options.twoFactor),
      })
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await hashPassword(PASSWORD),
      })
      if (options.twoFactor) {
        await db.insert(twoFactor).values({
          id: crypto.randomUUID(),
          userId: id,
          secret: await symmetricEncrypt({
            key: env.BETTER_AUTH_SECRET,
            data: TOTP_SECRET,
          }),
          backupCodes: await symmetricEncrypt({
            key: env.BETTER_AUTH_SECRET,
            data: '[]',
          }),
          verified: true,
        })
      }
      return { id, email }
    }

    async function registerApp(name: string) {
      const registered = await authPost('/oauth2/register', {
        client_name: name,
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'mcp offline_access openid',
      })
      expect(registered.status).toBeLessThan(300)
      const clientId = String(registered.json.client_id)
      clientIds.push(clientId)
      return clientId
    }

    /** Signs the admin in, approves the agency connector and exchanges the code. */
    async function connectAgency(input: { clientId: string; email: string }) {
      const flow = await signInForConsent({
        clientId: input.clientId,
        resource: AGENCY_URL,
        email: input.email,
        twoFactor: true,
      })
      cookiesAsHeaders(flow.jar)
      const approved = await approveAgencyConsentRequest({
        query: flow.consentQuery,
      })
      const exchanged = await exchange(flow, approved.redirectTo)
      expect(exchanged.status).toBe(200)
      return {
        access: String(exchanged.json.access_token),
        refresh: String(exchanged.json.refresh_token),
      }
    }

    async function connectionsFor(userId: string) {
      return db
        .select()
        .from(mcpConnection)
        .where(
          and(
            eq(mcpConnection.userId, userId),
            eq(mcpConnection.scope, 'agency'),
          ),
        )
        .orderBy(desc(mcpConnection.createdAt))
    }

    /** The newest session of a user: the one a sign-in just created. */
    async function newestSessionId(userId: string) {
      const [row] = await db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.userId, userId))
        .orderBy(desc(session.createdAt))
        .limit(1)
      if (!row) throw new Error('no session for the user')
      return row.id
    }

    beforeAll(async () => {
      ctx = await createTestSite()
      admin = await makeUser('agency-admin', {
        agencyAdmin: true,
        twoFactor: true,
      })
      leaver = await makeUser('agency-leaver', {
        agencyAdmin: true,
        twoFactor: true,
      })
      adminNoMfa = await makeUser('agency-lost-mfa', {
        agencyAdmin: true,
        twoFactor: true,
      })
      siteOwner = await makeUser('site-owner')
      await db.insert(membership).values({
        userId: siteOwner.id,
        organizationId: ctx.org.id,
        role: 'owner',
      })
    }, 120_000)

    afterAll(async () => {
      if (!runnable) return
      if (clientIds.length > 0) {
        await db
          .delete(oauthClient)
          .where(inArray(oauthClient.clientId, clientIds))
      }
      await db
        .delete(oauthResource)
        .where(
          inArray(oauthResource.identifier, [
            AGENCY_URL,
            mcpResourceUrl(ctx.site.slug),
          ]),
        )
      await cleanupTestSite(ctx)
      await db.delete(user).where(inArray(user.id, createdUsers))
    }, 120_000)

    describe('the agency resource: discovery and challenge', () => {
      it('serves the protected resource metadata for the agency address, never cached', async () => {
        const response = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-protected-resource/api/agency/mcp`,
          ),
        )
        expect(response?.status).toBe(200)
        const prm = (await response?.json()) as Record<string, unknown>
        expect(prm).toMatchObject({
          resource: AGENCY_URL,
          resource_name: 'Areca agency',
          bearer_methods_supported: ['header'],
        })
        expect(prm.authorization_servers).toEqual([
          (await auth.api.getOAuthServerConfig()).issuer,
        ])
        expect(response?.headers.get('cache-control')).toBe('no-store')
        expect(response?.headers.get('access-control-allow-origin')).toBe('*')
      })

      it('answers 404 for other paths under the agency address', async () => {
        const response = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-protected-resource/api/agency/other`,
          ),
        )
        expect(response?.status).toBe(404)
      })

      it('answers 401 with the agency metadata challenge when no credential is sent', async () => {
        const response = await handleAgencyMcpRequest(pingRequest(AGENCY_URL))
        expect(response.status).toBe(401)
        const challenge = response.headers.get('www-authenticate') ?? ''
        expect(challenge).toContain(
          `resource_metadata="${protectedResourceMetadataUrlFor(AGENCY_URL)}"`,
        )
        expect(challenge).toContain('scope="mcp offline_access"')
      })
    })

    describe('approval', () => {
      it('describes the agency approval for an agency admin with MFA: no site, no go-live', async () => {
        const clientId = await registerApp('Agency describe app')
        const flow = await signInForConsent({
          clientId,
          resource: AGENCY_URL,
          email: admin.email,
          twoFactor: true,
        })
        cookiesAsHeaders(flow.jar)
        const info = await describeConsentRequest(flow.consentQuery)
        expect(info).toMatchObject({
          ok: true,
          kind: 'agency',
          client: { name: 'Agency describe app' },
          warning: {
            title: 'Connect Agency describe app to every client',
            body: 'This app can read and change every client and site, including production, and go live.',
          },
          needsStepUp: false,
        })
        expect(info).not.toHaveProperty('site')
      })

      it('refuses a user who is not an agency admin: no description and no approval', async () => {
        const clientId = await registerApp('Owner agency app')
        const flow = await signInForConsent({
          clientId,
          resource: AGENCY_URL,
          email: siteOwner.email,
          twoFactor: false,
        })
        cookiesAsHeaders(flow.jar)
        expect(await describeConsentRequest(flow.consentQuery)).toMatchObject({
          ok: false,
          reason: 'no_access',
        })
        const refused = await approveAgencyConsentRequest({
          query: flow.consentQuery,
        }).catch((error: unknown) => error)
        expect(refused).toBeInstanceOf(Response)
        expect((refused as Response).status).toBe(403)
        expect(await connectionsFor(siteOwner.id)).toHaveLength(0)
      })

      it('refuses an agency admin who has lost two-factor auth since signing in', async () => {
        // Admins without two-factor cannot sign in at all, so the factor is
        // removed after the sign-in, as an admin's own settings change would do.
        const clientId = await registerApp('No MFA agency app')
        const flow = await signInForConsent({
          clientId,
          resource: AGENCY_URL,
          email: adminNoMfa.email,
          twoFactor: true,
        })
        await db
          .update(user)
          .set({ twoFactorEnabled: false })
          .where(eq(user.id, adminNoMfa.id))
        cookiesAsHeaders(flow.jar)
        expect(await describeConsentRequest(flow.consentQuery)).toMatchObject({
          ok: false,
          reason: 'no_access',
        })
        await expect(
          approveAgencyConsentRequest({ query: flow.consentQuery }),
        ).rejects.toBeInstanceOf(MfaRequiredError)
        expect(await connectionsFor(adminNoMfa.id)).toHaveLength(0)
      })

      it('needs a fresh second factor: a stale session is asked to step up first', async () => {
        const clientId = await registerApp('Stale agency app')
        const flow = await signInForConsent({
          clientId,
          resource: AGENCY_URL,
          email: admin.email,
          twoFactor: true,
        })
        // The local factor proof of this session is now older than the window.
        const sessionId = await newestSessionId(admin.id)
        await db
          .update(verification)
          .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
          .where(eq(verification.id, `local-mfa:${sessionId}`))

        cookiesAsHeaders(flow.jar)
        expect(await describeConsentRequest(flow.consentQuery)).toMatchObject({
          ok: true,
          kind: 'agency',
          needsStepUp: true,
        })
        await expect(
          approveAgencyConsentRequest({ query: flow.consentQuery }),
        ).rejects.toBeInstanceOf(ReauthRequiredError)
        expect(await connectionsFor(admin.id)).toHaveLength(0)

        await recordStepUp(sessionId, admin.id)
        const approved = await approveAgencyConsentRequest({
          query: flow.consentQuery,
        })
        expect(approved.redirectTo).toContain('code=')
        expect(await connectionsFor(admin.id)).toHaveLength(1)
      })
    })

    describe('tokens and the agency endpoint', () => {
      let agencyAccess = ''
      let agencyRefresh = ''
      let agencyConnectionId = ''

      it('approves, exchanges the code, and lists the agency tools with the stored connection', async () => {
        const clientId = await registerApp('Agency e2e app')
        const tokens = await connectAgency({
          clientId,
          email: admin.email,
        })
        agencyAccess = tokens.access
        agencyRefresh = tokens.refresh
        expect(agencyAccess.startsWith('areca_at_')).toBe(true)
        expect(agencyRefresh.startsWith('areca_rt_')).toBe(true)

        const [connection] = await connectionsFor(admin.id)
        expect(connection).toMatchObject({
          clientId,
          clientName: 'Agency e2e app',
          scope: 'agency',
          siteId: null,
          allowGoLive: false,
          revokedAt: null,
        })
        agencyConnectionId = connection?.id ?? ''

        const client = await agencyClient(agencyAccess)
        const { tools } = await client.listTools()
        const names = tools.map((tool) => tool.name)
        expect(names).toEqual(
          expect.arrayContaining([
            'list_sites',
            'find_site',
            'list_clients',
            'list_entries',
            'go_live',
          ]),
        )
        const listed = await client.callTool({
          name: 'list_sites',
          arguments: {},
        })
        expect(listed.isError).toBeFalsy()
        expect(JSON.stringify(listed.content)).toContain(ctx.site.slug)
        await client.close()
      })

      it('refuses a site token on the agency address, and an agency token on a site address', async () => {
        // The admin also connects one site: that token belongs to the site resource.
        const clientId = await registerApp('Site token app')
        const flow = await signInForConsent({
          clientId,
          resource: mcpResourceUrl(ctx.site.slug),
          email: admin.email,
          twoFactor: true,
        })
        cookiesAsHeaders(flow.jar)
        const approved = await approveConsentRequest({
          query: flow.consentQuery,
          siteId: ctx.site.id,
          allowGoLive: false,
        })
        const siteToken = String(
          (await exchange(flow, approved.redirectTo)).json.access_token,
        )

        const onAgency = await handleAgencyMcpRequest(
          pingRequest(AGENCY_URL, siteToken),
        )
        expect(onAgency.status).toBe(401)
        expect(onAgency.headers.get('www-authenticate')).toContain(
          'resource_metadata=',
        )

        const onSite = await handleSiteMcpRequest(
          pingRequest(mcpResourceUrl(ctx.site.slug), agencyAccess),
          ctx.site.slug,
        )
        expect(onSite.status).toBe(401)
        expect(onSite.headers.get('www-authenticate')).toContain(
          'resource_metadata=',
        )
      })

      it('lists the caller’s agency apps and revokes one; another admin’s answers NotFound', async () => {
        const listed = await listAgencyConnections({ userId: admin.id })
        expect(listed.map((row) => row.clientName)).toContain('Agency e2e app')
        expect(listed.map((row) => row.id)).toContain(agencyConnectionId)

        // Another agency admin cannot see or revoke this app: NotFound.
        await expect(
          revokeAgencyConnection({
            id: agencyConnectionId,
            actorId: leaver.id,
          }),
        ).rejects.toMatchObject({ status: 404 })
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, agencyAccess)))
            .status,
        ).toBe(200)
      })

      it('re-approving after the previous connection went idle retires that generation and its tokens', async () => {
        const clientId = await registerApp('Renewed agency app')
        const first = await connectAgency({ clientId, email: admin.email })
        const [previous] = await db
          .select({ id: mcpConnection.id })
          .from(mcpConnection)
          .where(
            and(
              eq(mcpConnection.clientId, clientId),
              eq(mcpConnection.scope, 'agency'),
            ),
          )
        const oldId = previous?.id ?? ''
        expect(oldId).not.toBe('')
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, first.access)))
            .status,
        ).toBe(200)

        // Idle for longer than the connection window (90 days).
        const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
        await db
          .update(mcpConnection)
          .set({ createdAt: longAgo, lastUsedAt: longAgo })
          .where(eq(mcpConnection.id, oldId))

        const flow = await signInForConsent({
          clientId,
          resource: AGENCY_URL,
          email: admin.email,
          twoFactor: true,
        })
        cookiesAsHeaders(flow.jar)
        const approved = await approveAgencyConsentRequest({
          query: flow.consentQuery,
        })
        const second = String(
          (await exchange(flow, approved.redirectTo)).json.access_token,
        )

        const [retired] = await db
          .select({ revokedAt: mcpConnection.revokedAt })
          .from(mcpConnection)
          .where(eq(mcpConnection.id, oldId))
        expect(retired?.revokedAt).not.toBeNull()
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, first.access)))
            .status,
        ).toBe(401)
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, second)))
            .status,
        ).toBe(200)

        const active = await db
          .select({ id: mcpConnection.id })
          .from(mcpConnection)
          .where(
            and(
              eq(mcpConnection.clientId, clientId),
              eq(mcpConnection.scope, 'agency'),
              isNull(mcpConnection.revokedAt),
            ),
          )
        expect(active).toHaveLength(1)
        expect(active[0]?.id).not.toBe(oldId)
      })

      it('revoking the app stops its token at once', async () => {
        const clientId = await registerApp('Revoked agency app')
        const tokens = await connectAgency({ clientId, email: admin.email })
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, tokens.access)))
            .status,
        ).toBe(200)
        const [row] = await db
          .select({ id: mcpConnection.id })
          .from(mcpConnection)
          .where(
            and(
              eq(mcpConnection.clientId, clientId),
              eq(mcpConnection.scope, 'agency'),
            ),
          )
        await revokeAgencyConnection({ id: row?.id ?? '', actorId: admin.id })
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, tokens.access)))
            .status,
        ).toBe(401)
      })
    })

    describe('losing the agency admin role', () => {
      it('revokes the app and its tokens when the admin is demoted', async () => {
        const clientId = await registerApp('Leaver agency app')
        const tokens = await connectAgency({
          clientId,
          email: leaver.email,
        })
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, tokens.access)))
            .status,
        ).toBe(200)

        await setAgencyAdmin(leaver.id, false, admin.id)

        const [row] = await db
          .select({ revokedAt: mcpConnection.revokedAt })
          .from(mcpConnection)
          .where(
            and(
              eq(mcpConnection.clientId, clientId),
              eq(mcpConnection.scope, 'agency'),
            ),
          )
        expect(row?.revokedAt).not.toBeNull()
        expect(
          (await handleAgencyMcpRequest(pingRequest(AGENCY_URL, tokens.access)))
            .status,
        ).toBe(401)
        // The refresh token is revoked too, so the app cannot renew itself.
        const refreshed = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh,
          client_id: clientId,
          resource: AGENCY_URL,
        })
        expect(refreshed.status).toBeGreaterThanOrEqual(400)
      })
    })
  },
)
