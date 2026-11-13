/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups are checked defensively */
import { createHash, createHmac, randomBytes } from 'node:crypto'

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { hashPassword, symmetricEncrypt } from 'better-auth/crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as StartServer from '@tanstack/react-start/server'

import { db } from '#/db'
import {
  membership,
  session,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  account,
  mcpConnection,
  twoFactor,
  user,
} from '#/db/schema'
import { env } from '#/env'
import { securityErrorCode } from '#/lib/security-errors'
import { createTestSite, cleanupTestSite } from '#/server/content/test-utils'

import { handleDiscoveryRequest } from './discovery'
import { createMcpKey } from './keys'
import { mcpResourceUrl } from './oauth-resource'
import { handleSiteMcpRequest } from './http'
import { auth } from '#/lib/auth'
import {
  approveConsentRequest,
  describeConsentRequest,
  denyConsentRequest,
} from './consent'
import { listConnections, revokeConnection } from './connections'

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

const AUTH_ORIGIN = new URL(env.BETTER_AUTH_URL).origin
const AUTH_BASE = `${AUTH_ORIGIN}/api/auth`
/**
 * The issuer the plugin advertises. It is https for any non-loopback host, so
 * on a LAN address it differs from AUTH_BASE; tests compare against this.
 */
let ISSUER = AUTH_BASE
const REDIRECT_URI = 'http://localhost:9999/callback'
/** Clients registered by these tests, removed in afterAll. */
const createdClientIds: string[] = []
const PASSWORD = 'Correct-horse-battery-1'
const TOTP_SECRET = 'areca-test-totp-secret-0123456789'

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

/** A JSON call to the Better Auth handler, carrying and updating `jar`. */
async function authPost(
  path: string,
  body: unknown,
  jar: Jar = new Map(),
): Promise<{
  status: number
  json: Record<string, unknown>
  response: Response
}> {
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
    response,
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

/** The signed query the plugin appends when it sends a user to /login. */
async function startAuthorization(input: {
  clientId: string
  slug: string
  pkce: { challenge: string }
  state: string
  redirectUri?: string
  /** Omitted from the request when null; defaults to `mcp offline_access openid`. */
  scope?: string | null
  /** Omitted from the request when null; defaults to the site's resource. */
  resource?: string | null
}): Promise<string> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri ?? REDIRECT_URI,
    response_type: 'code',
    state: input.state,
    code_challenge: input.pkce.challenge,
    code_challenge_method: 'S256',
  })
  if (input.scope !== null)
    params.set('scope', input.scope ?? 'mcp offline_access openid')
  if (input.resource !== null)
    params.set('resource', input.resource ?? mcpResourceUrl(input.slug))
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

/** The Location of an authorize request, for requests that must fail. */
async function authorizeRaw(params: Record<string, string>): Promise<string> {
  const response = await auth.handler(
    new Request(
      `${AUTH_BASE}/oauth2/authorize?${new URLSearchParams(params)}`,
      {
        headers: { accept: 'text/html' },
        redirect: 'manual',
      },
    ),
  )
  return response.headers.get('location') ?? ''
}

function cookiesAsHeaders(jar: Jar) {
  requestState.headers = new Headers({ cookie: cookieHeader(jar) })
}

/** Connects a real MCP client straight into the per-site route (no sockets). */
async function mcpClient(slug: string, token: string) {
  const client = new Client({ name: 'areca-oauth-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(mcpResourceUrl(slug)),
    {
      fetch: (input, init) =>
        handleSiteMcpRequest(new Request(input, init), slug),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    },
  )
  await client.connect(transport)
  return client
}

async function toolNames(client: Client) {
  const { tools } = await client.listTools()
  return tools.map((tool) => tool.name).sort()
}

describe.skipIf(!hasDb)(
  'OAuth connector: discovery and the per-site endpoint',
  () => {
    let ctx: Awaited<ReturnType<typeof createTestSite>>
    let other: Awaited<ReturnType<typeof createTestSite>>
    const ownerEmail = `owner-${crypto.randomUUID()}@test.local`
    let ownerId = ''
    const extraUsers: string[] = []

    beforeAll(async () => {
      ISSUER = (await auth.api.getOAuthServerConfig()).issuer
      ctx = await createTestSite()
      other = await createTestSite()
      // The owner belongs to both organizations, so a token for one site can be
      // tried against the other.
      ownerId = ctx.actor.id
      await db
        .update(user)
        .set({ email: ownerEmail })
        .where(eq(user.id, ownerId))
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: ownerId,
        providerId: 'credential',
        userId: ownerId,
        password: await hashPassword(PASSWORD),
      })
      await db.insert(membership).values([
        { userId: ownerId, organizationId: ctx.org.id, role: 'owner' },
        { userId: ownerId, organizationId: other.org.id, role: 'owner' },
      ])
    })

    afterAll(async () => {
      await db.delete(oauthClient).where(eq(oauthClient.name, 'OAuth e2e app'))
      if (createdClientIds.length > 0) {
        await db
          .delete(oauthClient)
          .where(inArray(oauthClient.clientId, createdClientIds))
      }
      await db
        .delete(oauthResource)
        .where(
          inArray(oauthResource.identifier, [
            mcpResourceUrl(ctx.site.slug),
            mcpResourceUrl(other.site.slug),
          ]),
        )
      await db.delete(user).where(inArray(user.id, extraUsers))
      await cleanupTestSite(ctx)
      await cleanupTestSite(other)
      await db.delete(user).where(eq(user.id, ownerId))
    })

    async function addUser(
      label: string,
      role: 'editor' | 'owner',
      options: { twoFactor?: boolean } = {},
    ) {
      const id = crypto.randomUUID()
      extraUsers.push(id)
      await db.insert(user).values({
        id,
        name: label,
        email: `${label}-${id}@test.local`,
        emailVerified: true,
        twoFactorEnabled: Boolean(options.twoFactor),
      })
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await hashPassword(PASSWORD),
      })
      await db
        .insert(membership)
        .values({ userId: id, organizationId: ctx.org.id, role })
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
      return { id, email: `${label}-${id}@test.local` }
    }

    async function registerClient() {
      const registered = await authPost('/oauth2/register', {
        client_name: 'OAuth e2e app',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'mcp offline_access openid',
      })
      expect(registered.status).toBeLessThan(300)
      createdClientIds.push(String(registered.json.client_id))
      return String(registered.json.client_id)
    }

    describe('discovery documents', () => {
      it('serves AS and OIDC metadata with one issuer that matches the plugin', async () => {
        const oauthMeta = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-authorization-server/api/auth`,
          ),
        )
        expect(oauthMeta?.status).toBe(200)
        const as = (await oauthMeta?.json()) as Record<string, unknown>
        expect(as.issuer).toBe(ISSUER)
        expect(new URL(ISSUER).pathname).toBe('/api/auth')
        expect(as.authorization_endpoint).toBe(`${AUTH_BASE}/oauth2/authorize`)
        expect(as.token_endpoint).toBe(`${AUTH_BASE}/oauth2/token`)
        expect(as.registration_endpoint).toBe(`${AUTH_BASE}/oauth2/register`)
        expect(as.code_challenge_methods_supported).toEqual(['S256'])
        expect(as.authorization_response_iss_parameter_supported).toBe(true)
        expect(as.scopes_supported).toEqual(
          expect.arrayContaining(['mcp', 'openid', 'offline_access']),
        )

        const oidc = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/openid-configuration/api/auth`,
          ),
        )
        expect(((await oidc?.json()) as { issuer: string }).issuer).toBe(ISSUER)

        // The plugin's own probe under the auth handler agrees on the issuer.
        const pluginOidc = await auth.handler(
          new Request(`${AUTH_BASE}/.well-known/openid-configuration`),
        )
        expect(((await pluginOidc.json()) as { issuer: string }).issuer).toBe(
          ISSUER,
        )
      })

      it('serves the same metadata at the origin root, with the issuer unchanged', async () => {
        const pathInserted = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-authorization-server/api/auth`,
          ),
        )
        const root = await handleDiscoveryRequest(
          new Request(`${AUTH_ORIGIN}/.well-known/oauth-authorization-server`),
        )
        expect(root?.status).toBe(200)
        expect(root?.headers.get('access-control-allow-origin')).toBe('*')
        const rootAs = (await root?.json()) as Record<string, unknown>
        expect(rootAs).toEqual(await pathInserted?.json())
        expect(rootAs.issuer).toBe(ISSUER)

        const rootOidc = await handleDiscoveryRequest(
          new Request(`${AUTH_ORIGIN}/.well-known/openid-configuration`),
        )
        expect(rootOidc?.status).toBe(200)
        expect(rootOidc?.headers.get('access-control-allow-origin')).toBe('*')
        const oidc = (await rootOidc?.json()) as Record<string, unknown>
        expect(oidc.issuer).toBe(ISSUER)
        const pathInsertedOidc = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/openid-configuration/api/auth`,
          ),
        )
        expect(oidc).toEqual(await pathInsertedOidc?.json())
      })

      it('answers CORS preflight and HEAD for the origin-root metadata', async () => {
        const preflight = await handleDiscoveryRequest(
          new Request(`${AUTH_ORIGIN}/.well-known/openid-configuration`, {
            method: 'OPTIONS',
          }),
        )
        expect(preflight?.status).toBe(204)
        expect(preflight?.headers.get('access-control-allow-origin')).toBe('*')
        const head = await handleDiscoveryRequest(
          new Request(`${AUTH_ORIGIN}/.well-known/oauth-authorization-server`, {
            method: 'HEAD',
          }),
        )
        expect(head?.status).toBe(200)
      })

      it('serves nothing for other origin-root well-known paths', async () => {
        expect(
          await handleDiscoveryRequest(
            new Request(
              `${AUTH_ORIGIN}/.well-known/oauth-authorization-server/other`,
            ),
          ),
        ).toBeNull()
      })

      it('serves the protected resource metadata exactly for the site resource', async () => {
        const response = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-protected-resource/api/mcp/${ctx.site.slug}`,
          ),
        )
        expect(response?.status).toBe(200)
        const prm = (await response?.json()) as Record<string, unknown>
        expect(prm.resource).toBe(mcpResourceUrl(ctx.site.slug))
        expect(prm.authorization_servers).toEqual([ISSUER])
        expect(prm.bearer_methods_supported).toEqual(['header'])
        expect(prm.resource_name).toBe(`${ctx.site.name} (Areca CMS)`)
        expect(response?.headers.get('access-control-allow-origin')).toBe('*')
      })

      it('answers 404 for an unknown site slug and for other paths under the resource', async () => {
        const unknown = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-protected-resource/api/mcp/no-such-site`,
          ),
        )
        expect(unknown?.status).toBe(404)
        const wrongPath = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-protected-resource/api/other/${ctx.site.slug}`,
          ),
        )
        expect(wrongPath?.status).toBe(404)
      })

      it('answers CORS preflight for metadata', async () => {
        const response = await handleDiscoveryRequest(
          new Request(
            `${AUTH_ORIGIN}/.well-known/oauth-protected-resource/api/mcp/${ctx.site.slug}`,
            {
              method: 'OPTIONS',
            },
          ),
        )
        expect(response?.status).toBe(204)
        expect(response?.headers.get('access-control-allow-origin')).toBe('*')
      })
    })

    describe('the per-site endpoint without a valid credential', () => {
      it('answers 401 with a resource_metadata challenge', async () => {
        const response = await handleSiteMcpRequest(
          new Request(mcpResourceUrl(ctx.site.slug), { method: 'POST' }),
          ctx.site.slug,
        )
        expect(response.status).toBe(401)
        const challenge = response.headers.get('www-authenticate') ?? ''
        expect(challenge.startsWith('Bearer ')).toBe(true)
        expect(challenge).toContain(
          `resource_metadata="${AUTH_ORIGIN}/.well-known/oauth-protected-resource/api/mcp/${ctx.site.slug}"`,
        )
        expect(challenge).toContain('scope="mcp offline_access"')
      })

      it('answers 404 for an unknown site slug', async () => {
        const response = await handleSiteMcpRequest(
          new Request(mcpResourceUrl('no-such-site'), { method: 'POST' }),
          'no-such-site',
        )
        expect(response.status).toBe(404)
      })

      it('accepts a personal key only for its own site', async () => {
        const created = await createMcpKey({
          userId: ownerId,
          siteId: ctx.site.id,
          organizationId: ctx.org.id,
          name: 'site match key',
          expiresInDays: 30,
          allowGoLive: false,
          role: 'owner',
        })
        const matching = await mcpClient(ctx.site.slug, created.token)
        expect(await toolNames(matching)).toContain('list_entries')
        await matching.close()

        const mismatched = await handleSiteMcpRequest(
          new Request(mcpResourceUrl(other.site.slug), {
            method: 'POST',
            headers: {
              authorization: `Bearer ${created.token}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
            }),
          }),
          other.site.slug,
        )
        expect(mismatched.status).toBe(401)
        expect(mismatched.headers.get('www-authenticate')).toContain(
          'resource_metadata=',
        )
      })
    })

    describe('connecting an app with OAuth', () => {
      let clientId = ''
      let ownerAccess = ''
      let ownerRefresh = ''
      let ownerConnectionId = ''

      /** Registers a client as an app would, and records it for cleanup. */
      async function registerApp(metadata: Record<string, unknown>) {
        const registered = await authPost('/oauth2/register', metadata)
        if (registered.status < 300)
          createdClientIds.push(String(registered.json.client_id))
        return registered
      }

      /**
       * Signs the owner-side user in, consents, and exchanges the code. The
       * options cover what real apps vary: the redirect, the scope they ask for,
       * whether `resource` is sent on authorize and/or token, and client secret.
       */
      async function exchangeForApp(input: {
        clientId: string
        slug: string
        siteId: string
        email: string
        state: string
        allowGoLive: boolean
        redirectUri?: string
        scope?: string | null
        authorizeResource?: boolean
        tokenResource?: string | false
        clientSecret?: string
      }) {
        const redirectUri = input.redirectUri ?? REDIRECT_URI
        const pkce = pkcePair()
        const loginQuery = await startAuthorization({
          clientId: input.clientId,
          slug: input.slug,
          pkce,
          state: input.state,
          redirectUri,
          scope: input.scope,
          resource: input.authorizeResource === false ? null : undefined,
        })
        const jar: Jar = new Map()
        const signIn = await authPost(
          '/sign-in/email',
          { email: input.email, password: PASSWORD, oauth_query: loginQuery },
          jar,
        )
        expect(signIn.status).toBe(200)
        const next = new URL(String(signIn.json.url), AUTH_ORIGIN)
        let code = next.searchParams.get('code')
        if (next.pathname.endsWith('/oauth/consent')) {
          cookiesAsHeaders(jar)
          const approved = await approveConsentRequest({
            query: next.search.slice(1),
            siteId: input.siteId,
            allowGoLive: input.allowGoLive,
          })
          code = new URL(approved.redirectTo).searchParams.get('code')
        }
        return tokenRequest({
          grant_type: 'authorization_code',
          code: code ?? '',
          redirect_uri: redirectUri,
          client_id: input.clientId,
          code_verifier: pkce.verifier,
          ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
          ...(input.tokenResource === false
            ? {}
            : { resource: input.tokenResource ?? mcpResourceUrl(input.slug) }),
        })
      }

      /** `exchangeForApp`, asserting that tokens were issued. */
      async function connectApp(input: Parameters<typeof exchangeForApp>[0]) {
        const exchanged = await exchangeForApp(input)
        expect(exchanged.status).toBe(200)
        return {
          access: String(exchanged.json.access_token),
          refresh: String(exchanged.json.refresh_token),
          scope: String(exchanged.json.scope ?? ''),
        }
      }

      it('registers a public client anonymously and records the site resource', async () => {
        clientId = await registerClient()
        expect(clientId.length).toBeGreaterThan(8)
      })

      it('runs authorization with PKCE, owner consent and token exchange', async () => {
        const pkce = pkcePair()
        const loginQuery = await startAuthorization({
          clientId,
          slug: ctx.site.slug,
          pkce,
          state: 'owner-state',
        })

        const jar: Jar = new Map()
        const signIn = await authPost(
          '/sign-in/email',
          { email: ownerEmail, password: PASSWORD, oauth_query: loginQuery },
          jar,
        )
        expect(signIn.status).toBe(200)
        expect(String(signIn.json.url)).toContain('/oauth/consent?')
        const consentQuery = new URL(
          String(signIn.json.url),
          AUTH_ORIGIN,
        ).search.slice(1)

        cookiesAsHeaders(jar)
        const info = await describeConsentRequest(consentQuery)
        expect(info).toMatchObject({
          ok: true,
          client: { name: 'OAuth e2e app', redirectHost: 'localhost:9999' },
          site: { id: ctx.site.id, slug: ctx.site.slug },
          role: 'owner',
          canAllowGoLive: true,
          needsStepUp: false,
        })

        const approved = await approveConsentRequest({
          query: consentQuery,
          siteId: ctx.site.id,
          allowGoLive: true,
        })
        const redirect = new URL(approved.redirectTo)
        expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI)
        expect(redirect.searchParams.get('state')).toBe('owner-state')
        expect(redirect.searchParams.get('iss')).toBe(ISSUER)
        const code = redirect.searchParams.get('code')
        expect(code).toBeTruthy()

        const exchanged = await tokenRequest({
          grant_type: 'authorization_code',
          code: code ?? '',
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: pkce.verifier,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(exchanged.status).toBe(200)
        ownerAccess = String(exchanged.json.access_token)
        ownerRefresh = String(exchanged.json.refresh_token)
        expect(ownerAccess.startsWith('areca_at_')).toBe(true)
        expect(ownerRefresh.startsWith('areca_rt_')).toBe(true)
        expect(String(exchanged.json.scope)).toContain('mcp')
        expect(exchanged.json.expires_in).toBe(3600)

        const [resource] = await db
          .select()
          .from(oauthResource)
          .where(eq(oauthResource.identifier, mcpResourceUrl(ctx.site.slug)))
        expect(resource).toBeDefined()

        const [connection] = await db
          .select()
          .from(mcpConnection)
          .where(
            and(
              eq(mcpConnection.userId, ownerId),
              eq(mcpConnection.siteId, ctx.site.id),
              eq(mcpConnection.clientId, clientId),
            ),
          )
        expect(connection?.allowGoLive).toBe(true)
        expect(connection?.revokedAt).toBeNull()
        ownerConnectionId = connection?.id ?? ''

        const consent = await db
          .select()
          .from(oauthConsent)
          .where(
            and(
              eq(oauthConsent.clientId, clientId),
              eq(oauthConsent.userId, ownerId),
            ),
          )
        expect(consent.map((row) => row.referenceId)).toEqual([
          ownerConnectionId,
        ])
      })

      it('lets an owner with go-live use every tool, and gives the token the connection identity', async () => {
        const client = await mcpClient(ctx.site.slug, ownerAccess)
        const names = await toolNames(client)
        expect(names).toEqual(
          expect.arrayContaining(['mark_ready', 'go_live', 'list_entries']),
        )
        await client.close()
      })

      it('rotates the refresh token; a retry inside the reuse window gets the same tokens; reuse after it is replay', async () => {
        const refreshed = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: ownerRefresh,
          client_id: clientId,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(refreshed.status).toBe(200)
        const newAccess = String(refreshed.json.access_token)
        const newRefresh = String(refreshed.json.refresh_token)
        expect(newRefresh).not.toBe(ownerRefresh)

        const client = await mcpClient(ctx.site.slug, newAccess)
        expect(await toolNames(client)).toContain('list_entries')
        await client.close()

        // A client that lost the refresh response retries with the old token.
        // Inside the window the server answers with the response it already
        // issued, so the retry gets the tokens that were lost.
        const retry = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: ownerRefresh,
          client_id: clientId,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(retry.status).toBe(200)
        expect(String(retry.json.refresh_token)).toBe(newRefresh)
        expect(String(retry.json.access_token)).toBe(newAccess)

        // Once the window has closed, the same token is replay: the family
        // goes, including the tokens just issued.
        await db
          .update(oauthRefreshToken)
          .set({ rotationReplayExpiresAt: new Date(Date.now() - 1000) })
          .where(
            and(
              eq(oauthRefreshToken.clientId, clientId),
              eq(oauthRefreshToken.userId, ownerId),
              isNotNull(oauthRefreshToken.rotatedAt),
            ),
          )
        const replay = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: ownerRefresh,
          client_id: clientId,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(replay.status).toBe(400)
        expect(replay.json.error).toBe('invalid_grant')
        const afterReplay = await handleSiteMcpRequest(
          new Request(mcpResourceUrl(ctx.site.slug), {
            method: 'POST',
            headers: {
              authorization: `Bearer ${newAccess}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
            }),
          }),
          ctx.site.slug,
        )
        expect(afterReplay.status).toBe(401)

        const fresh = await connectApp({
          clientId,
          slug: ctx.site.slug,
          siteId: ctx.site.id,
          email: ownerEmail,
          state: 'owner-again',
          allowGoLive: true,
        })
        ownerAccess = fresh.access
        ownerRefresh = fresh.refresh
        const renewed = await db
          .select()
          .from(mcpConnection)
          .where(eq(mcpConnection.clientId, clientId))
        ownerConnectionId =
          renewed.find((row) => row.revokedAt === null)?.id ?? ''
      })

      it('answers invalid_grant for a refresh token that was never issued', async () => {
        const unknown = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: 'areca_rt_never-issued-0123456789',
          client_id: clientId,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(unknown.status).toBe(400)
        expect(unknown.json.error).toBe('invalid_grant')
      })

      it('refuses a token on a different site (RFC 8707 audience)', async () => {
        const response = await handleSiteMcpRequest(
          new Request(mcpResourceUrl(other.site.slug), {
            method: 'POST',
            headers: {
              authorization: `Bearer ${ownerAccess}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
            }),
          }),
          other.site.slug,
        )
        expect(response.status).toBe(401)
        expect(response.headers.get('www-authenticate')).toContain(
          'error="invalid_token"',
        )
      })

      it('shows the connection to its owner and disconnects it immediately', async () => {
        const visible = await listConnections({
          siteId: ctx.site.id,
          userId: ownerId,
          includeAllUsers: true,
        })
        expect(visible.map((row) => row.id)).toContain(ownerConnectionId)

        await revokeConnection({
          id: ownerConnectionId,
          siteId: ctx.site.id,
          actorId: ownerId,
          organizationId: ctx.org.id,
          canRevokeOthers: true,
        })

        const response = await handleSiteMcpRequest(
          new Request(mcpResourceUrl(ctx.site.slug), {
            method: 'POST',
            headers: {
              authorization: `Bearer ${ownerAccess}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
            }),
          }),
          ctx.site.slug,
        )
        expect(response.status).toBe(401)

        const refused = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: ownerRefresh,
          client_id: clientId,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(refused.status).toBe(400)
        expect(refused.json.error).toBe('invalid_grant')

        const [revokedAccess] = await db
          .select({ revoked: oauthAccessToken.revoked })
          .from(oauthAccessToken)
          .where(
            and(
              eq(oauthAccessToken.clientId, clientId),
              eq(oauthAccessToken.userId, ownerId),
            ),
          )
          .limit(1)
        expect(revokedAccess?.revoked).not.toBeNull()
        const [revokedRefresh] = await db
          .select({ revoked: oauthRefreshToken.revoked })
          .from(oauthRefreshToken)
          .where(
            and(
              eq(oauthRefreshToken.clientId, clientId),
              eq(oauthRefreshToken.userId, ownerId),
            ),
          )
          .limit(1)
        expect(revokedRefresh?.revoked).not.toBeNull()
        const remainingConsent = await db
          .select()
          .from(oauthConsent)
          .where(
            and(
              eq(oauthConsent.clientId, clientId),
              eq(oauthConsent.userId, ownerId),
            ),
          )
        expect(remainingConsent).toHaveLength(0)
      })

      it('gives an editor the editor tool list and refuses go-live', async () => {
        const editor = await addUser('editor', 'editor')
        const pkce = pkcePair()
        const loginQuery = await startAuthorization({
          clientId,
          slug: ctx.site.slug,
          pkce,
          state: 'editor-state',
        })
        const jar: Jar = new Map()
        const signIn = await authPost(
          '/sign-in/email',
          { email: editor.email, password: PASSWORD, oauth_query: loginQuery },
          jar,
        )
        const consentQuery = new URL(
          String(signIn.json.url),
          AUTH_ORIGIN,
        ).search.slice(1)
        cookiesAsHeaders(jar)

        const info = await describeConsentRequest(consentQuery)
        expect(info).toMatchObject({
          ok: true,
          role: 'editor',
          canAllowGoLive: false,
          needsStepUp: false,
        })

        // With two-factor on, a session that never entered a code (a provider
        // sign-in) is asked for one; the code dialog retries the approval.
        await db
          .update(user)
          .set({ twoFactorEnabled: true })
          .where(eq(user.id, editor.id))
        expect(await describeConsentRequest(consentQuery)).toMatchObject({
          needsStepUp: true,
        })
        const unverified: unknown = await approveConsentRequest({
          query: consentQuery,
          siteId: ctx.site.id,
          allowGoLive: false,
        }).catch((error: unknown) => error)
        expect(securityErrorCode(unverified)).toBe('REAUTH_REQUIRED')
        await db
          .update(user)
          .set({ twoFactorEnabled: false })
          .where(eq(user.id, editor.id))

        await expect(
          approveConsentRequest({
            query: consentQuery,
            siteId: ctx.site.id,
            allowGoLive: true,
          }),
        ).rejects.toThrow()

        const approved = await approveConsentRequest({
          query: consentQuery,
          siteId: ctx.site.id,
          allowGoLive: false,
        })
        const code = new URL(approved.redirectTo).searchParams.get('code') ?? ''
        const exchanged = await tokenRequest({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: pkce.verifier,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(exchanged.status).toBe(200)

        const client = await mcpClient(
          ctx.site.slug,
          String(exchanged.json.access_token),
        )
        const names = await toolNames(client)
        expect(names).toContain('list_entries')
        expect(names).toContain('create_entry')
        expect(names).not.toContain('mark_ready')
        expect(names).not.toContain('go_live')
        await client.close()
      })

      it('tells a signed-out user to sign in, and refuses a tampered request', async () => {
        const pkce = pkcePair()
        const loginQuery = await startAuthorization({
          clientId: await registerClient(),
          slug: ctx.site.slug,
          pkce,
          state: 'anon-state',
        })
        requestState.headers = new Headers()
        expect(await describeConsentRequest(loginQuery)).toMatchObject({
          ok: false,
          reason: 'signed_out',
        })

        const tampered = loginQuery.replace(/sig=[^&]+/, 'sig=forged')
        expect(await describeConsentRequest(tampered)).toMatchObject({
          ok: false,
          reason: 'invalid_request',
        })
        await expect(denyConsentRequest(tampered)).rejects.toThrow()
      })

      it('lets a denied request end with access_denied and no connection', async () => {
        const denied = await addUser('denier', 'editor')
        const pkce = pkcePair()
        const loginQuery = await startAuthorization({
          clientId,
          slug: other.site.slug,
          pkce,
          state: 'deny-state',
        })
        // The denier is not a member of the other organization.
        const jar: Jar = new Map()
        const signIn = await authPost(
          '/sign-in/email',
          { email: denied.email, password: PASSWORD, oauth_query: loginQuery },
          jar,
        )
        const consentQuery = new URL(
          String(signIn.json.url),
          AUTH_ORIGIN,
        ).search.slice(1)
        cookiesAsHeaders(jar)

        const info = await describeConsentRequest(consentQuery)
        expect(info).toMatchObject({ ok: false, reason: 'no_access' })
        const refused = await denyConsentRequest(consentQuery)
        const redirect = new URL(refused.redirectTo)
        expect(redirect.searchParams.get('error')).toBe('access_denied')
        const connections = await db
          .select()
          .from(mcpConnection)
          .where(eq(mcpConnection.userId, denied.id))
        expect(connections).toHaveLength(0)
      })

      it('refuses a token from a direct consent call that skips the site consent screen', async () => {
        // A client calls the plugin's own consent endpoint with accept=true, as
        // the consent page would, but never reaches approveConsentRequest. The
        // plugin then issues a token, yet no mcp_connection exists for it.
        const directClientId = await registerClient()
        const pkce = pkcePair()
        const loginQuery = await startAuthorization({
          clientId: directClientId,
          slug: ctx.site.slug,
          pkce,
          state: 'direct-state',
        })
        const jar: Jar = new Map()
        const signIn = await authPost(
          '/sign-in/email',
          { email: ownerEmail, password: PASSWORD, oauth_query: loginQuery },
          jar,
        )
        expect(signIn.status).toBe(200)
        const consentQuery = new URL(
          String(signIn.json.url),
          AUTH_ORIGIN,
        ).search.slice(1)

        const consent = await authPost(
          '/oauth2/consent',
          { accept: true, oauth_query: consentQuery },
          jar,
        )
        expect(consent.status).toBe(200)
        const next = String(consent.json.url ?? consent.json.redirect_uri ?? '')
        const code = new URL(next).searchParams.get('code')
        expect(code).toBeTruthy()

        const exchanged = await tokenRequest({
          grant_type: 'authorization_code',
          code: code ?? '',
          redirect_uri: REDIRECT_URI,
          client_id: directClientId,
          code_verifier: pkce.verifier,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(exchanged.status).toBe(400)
        expect(exchanged.json.error).toBe('invalid_grant')
      })

      describe('the client shapes AI apps register', () => {
        const grantFields = {
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }
        const shapes: Array<{
          app: string
          redirectUris: string[]
          /** The redirect the app sends to /authorize (one it registered). */
          redirect: string
          authMethod: 'none' | 'client_secret_post'
        }> = [
          {
            app: 'Claude Code',
            redirectUris: ['http://localhost:52811/callback'],
            redirect: 'http://localhost:52811/callback',
            authMethod: 'none',
          },
          {
            app: 'Cursor',
            redirectUris: ['http://localhost:8787/callback'],
            redirect: 'http://localhost:8787/callback',
            authMethod: 'none',
          },
          {
            app: 'Gemini CLI',
            redirectUris: ['http://localhost:45123/oauth/callback'],
            redirect: 'http://localhost:45123/oauth/callback',
            authMethod: 'none',
          },
          {
            app: 'VS Code (loopback)',
            redirectUris: ['http://127.0.0.1:33418/', 'http://127.0.0.1/'],
            redirect: 'http://127.0.0.1:33418/',
            authMethod: 'none',
          },
          {
            app: 'VS Code (mixed https and loopback)',
            redirectUris: [
              'https://vscode.dev/redirect',
              'http://127.0.0.1:33418/',
            ],
            redirect: 'https://vscode.dev/redirect',
            authMethod: 'none',
          },
          {
            app: 'ChatGPT',
            redirectUris: [
              'https://chatgpt.com/connector_platform_oauth_redirect',
            ],
            redirect: 'https://chatgpt.com/connector_platform_oauth_redirect',
            authMethod: 'none',
          },
          {
            app: 'Claude.ai (public)',
            redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
            redirect: 'https://claude.ai/api/mcp/auth_callback',
            authMethod: 'none',
          },
          {
            app: 'Claude.ai (client_secret_post)',
            redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
            redirect: 'https://claude.ai/api/mcp/auth_callback',
            authMethod: 'client_secret_post',
          },
        ]

        for (const shape of shapes) {
          it(`registers ${shape.app} and completes authorization with its redirect`, async () => {
            const registered = await registerApp({
              client_name: `${shape.app} (test)`,
              redirect_uris: shape.redirectUris,
              token_endpoint_auth_method: shape.authMethod,
              ...grantFields,
            })
            expect(registered.status).toBe(201)
            expect(registered.json.redirect_uris).toEqual(shape.redirectUris)
            const shapeClientId = String(registered.json.client_id)
            const clientSecret = registered.json.client_secret
              ? String(registered.json.client_secret)
              : undefined
            expect(Boolean(clientSecret)).toBe(
              shape.authMethod === 'client_secret_post',
            )

            // Claude's request names the resource on both legs, and it may
            // leave `scope` out; both paths are covered in the scope tests.
            const tokens = await connectApp({
              clientId: shapeClientId,
              slug: ctx.site.slug,
              siteId: ctx.site.id,
              email: ownerEmail,
              state: `shape-${shape.app}`,
              allowGoLive: false,
              redirectUri: shape.redirect,
              clientSecret,
            })
            const client = await mcpClient(ctx.site.slug, tokens.access)
            expect(await toolNames(client)).toContain('list_entries')
            await client.close()
          })
        }

        it('accepts a loopback redirect on another port at authorization (RFC 8252 section 7.3)', async () => {
          const registered = await registerApp({
            client_name: 'Port-varying loopback app',
            redirect_uris: ['http://localhost:52811/callback'],
            token_endpoint_auth_method: 'none',
            ...grantFields,
          })
          const portClientId = String(registered.json.client_id)
          const tokens = await connectApp({
            clientId: portClientId,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'port-varies',
            allowGoLive: false,
            redirectUri: 'http://localhost:53022/callback',
          })
          expect(tokens.access.startsWith('areca_at_')).toBe(true)
        })

        it('refuses a redirect the client did not register', async () => {
          const registered = await registerApp({
            client_name: 'Strict redirect app',
            redirect_uris: ['http://localhost:52811/callback'],
            token_endpoint_auth_method: 'none',
            ...grantFields,
          })
          // Only the port of a loopback redirect may vary, never the path.
          const location = await authorizeRaw({
            client_id: String(registered.json.client_id),
            redirect_uri: 'http://localhost:52811/other',
            response_type: 'code',
            code_challenge: pkcePair().challenge,
            code_challenge_method: 'S256',
            state: 'unregistered-path',
            resource: mcpResourceUrl(ctx.site.slug),
          })
          expect(location).toContain('/api/auth/error?')
          expect(location).toContain('error=invalid_redirect')
          expect(location).not.toContain('/login?')
        })

        it.each([
          ['a non-loopback http redirect', ['http://evil.example/callback']],
          ['a loopback https redirect', ['https://localhost:8443/callback']],
          ['a custom scheme', ['cursor://anysphere.cursor-mcp/oauth/callback']],
          [
            'a custom scheme beside a loopback one',
            [
              'cursor://anysphere.cursor-mcp/oauth/callback',
              'http://localhost:8787/callback',
            ],
          ],
        ])('refuses a registration with %s', async (_label, redirect_uris) => {
          const registered = await registerApp({
            client_name: 'Refused app',
            redirect_uris,
            token_endpoint_auth_method: 'none',
            ...grantFields,
          })
          expect(registered.status).toBe(400)
          expect(registered.json.error).toBe('invalid_redirect_uri')
        })

        it('refuses loopback http when the client declares itself a web application', async () => {
          const registered = await registerApp({
            client_name: 'Web declared app',
            application_type: 'web',
            redirect_uris: ['http://localhost:8787/callback'],
            token_endpoint_auth_method: 'none',
            ...grantFields,
          })
          expect(registered.status).toBe(400)
          expect(registered.json.error).toBe('invalid_redirect_uri')
        })
      })

      describe('scope', () => {
        const chatgptRedirect =
          'https://chatgpt.com/connector_platform_oauth_redirect'
        let scopeClientId = ''

        beforeAll(async () => {
          const registered = await registerApp({
            client_name: 'ChatGPT-style scope app',
            redirect_uris: [chatgptRedirect],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          })
          scopeClientId = String(registered.json.client_id)
        })

        it('accepts every advertised scope, as ChatGPT requests them', async () => {
          const tokens = await connectApp({
            clientId: scopeClientId,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'all-scopes',
            allowGoLive: false,
            redirectUri: chatgptRedirect,
            scope: 'mcp offline_access openid profile email',
          })
          expect(tokens.scope.split(' ')).toEqual(
            expect.arrayContaining(['mcp', 'offline_access']),
          )
          const client = await mcpClient(ctx.site.slug, tokens.access)
          expect(await toolNames(client)).toContain('list_entries')
          await client.close()
        })

        it('issues MCP scope when the authorize request names no scope', async () => {
          const tokens = await connectApp({
            clientId: scopeClientId,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'no-scope',
            allowGoLive: false,
            redirectUri: chatgptRedirect,
            scope: null,
          })
          expect(tokens.scope.split(' ')).toEqual(
            expect.arrayContaining(['mcp', 'offline_access']),
          )
          const client = await mcpClient(ctx.site.slug, tokens.access)
          expect(await toolNames(client)).toContain('list_entries')
          await client.close()
        })

        it('refuses a scope the server does not offer, back at the client', async () => {
          const location = await authorizeRaw({
            client_id: scopeClientId,
            redirect_uri: chatgptRedirect,
            response_type: 'code',
            code_challenge: pkcePair().challenge,
            code_challenge_method: 'S256',
            state: 'unknown-scope',
            scope: 'mcp files:write',
            resource: mcpResourceUrl(ctx.site.slug),
          })
          expect(location.startsWith(chatgptRedirect)).toBe(true)
          expect(location).toContain('error=invalid_scope')
        })
      })

      describe('connection lifecycle regressions', () => {
        const requestTools = (slug: string, access: string) =>
          handleSiteMcpRequest(
            new Request(mcpResourceUrl(slug), {
              method: 'POST',
              headers: {
                authorization: `Bearer ${access}`,
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
              },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
              }),
            }),
            slug,
          )

        it('keeps offline grants working after browser session expiry', async () => {
          const id = await registerClient()
          const tokens = await connectApp({
            clientId: id,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'offline-expiry',
            allowGoLive: false,
          })
          const [access] = await db
            .select()
            .from(oauthAccessToken)
            .where(eq(oauthAccessToken.clientId, id))
          const [refresh] = await db
            .select()
            .from(oauthRefreshToken)
            .where(eq(oauthRefreshToken.clientId, id))
          expect(access.sessionId).toBeNull()
          expect(refresh.sessionId).toBeNull()
          await db
            .update(session)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(session.userId, ownerId))
          const rotated = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh,
            client_id: id,
          })
          expect(rotated.status).toBe(200)
          expect(
            (
              await requestTools(
                ctx.site.slug,
                String(rotated.json.access_token),
              )
            ).status,
          ).toBe(200)
        })

        it('requires fresh consent for idle connections and never revives their old tokens', async () => {
          const id = await registerClient()
          const original = await connectApp({
            clientId: id,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'idle-original',
            allowGoLive: true,
          })
          const [before] = await db
            .select()
            .from(mcpConnection)
            .where(eq(mcpConnection.clientId, id))
          const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000)
          await db
            .update(mcpConnection)
            .set({ createdAt: old, lastUsedAt: old })
            .where(eq(mcpConnection.id, before.id))
          const refused = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: original.refresh,
            client_id: id,
          })
          expect(refused.status).toBe(400)
          expect(refused.json.error).toBe('invalid_grant')
          const fresh = await connectApp({
            clientId: id,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'idle-reconnect',
            allowGoLive: false,
          })
          const rows = await db
            .select()
            .from(mcpConnection)
            .where(eq(mcpConnection.clientId, id))
          const current = rows.find((row) => row.revokedAt === null)
          expect(current?.id).not.toBe(before.id)
          expect(current?.allowGoLive).toBe(false)
          expect(
            (await requestTools(ctx.site.slug, original.access)).status,
          ).toBe(401)
          expect((await requestTools(ctx.site.slug, fresh.access)).status).toBe(
            200,
          )
        })

        it('rejects a cached rotation retry immediately after disconnect', async () => {
          const id = await registerClient()
          const tokens = await connectApp({
            clientId: id,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'revoke-grace',
            allowGoLive: false,
          })
          const rotated = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh,
            client_id: id,
          })
          expect(rotated.status).toBe(200)
          const [connection] = await db
            .select()
            .from(mcpConnection)
            .where(eq(mcpConnection.clientId, id))
          await revokeConnection({
            id: connection.id,
            siteId: ctx.site.id,
            actorId: ownerId,
            organizationId: ctx.org.id,
            canRevokeOthers: true,
          })
          for (const refresh of [
            tokens.refresh,
            String(rotated.json.refresh_token),
          ]) {
            const retry = await tokenRequest({
              grant_type: 'refresh_token',
              refresh_token: refresh,
              client_id: id,
            })
            expect(retry.status).toBe(400)
            expect(retry.json.error).toBe('invalid_grant')
          }
        })

        it('authenticates a confidential client before applying replay invalidation', async () => {
          const registered = await authPost('/oauth2/register', {
            client_name: 'OAuth e2e app',
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: 'client_secret_post',
            grant_types: ['authorization_code', 'refresh_token'],
          })
          const id = String(registered.json.client_id)
          const secret = String(registered.json.client_secret)
          createdClientIds.push(id)
          const original = await connectApp({
            clientId: id,
            clientSecret: secret,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'confidential-replay',
            allowGoLive: false,
          })
          const rotated = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: original.refresh,
            client_id: id,
            client_secret: secret,
          })
          expect(rotated.status).toBe(200)
          await db
            .update(oauthRefreshToken)
            .set({ rotationReplayExpiresAt: new Date(Date.now() - 1000) })
            .where(
              and(
                eq(oauthRefreshToken.clientId, id),
                isNotNull(oauthRefreshToken.rotatedAt),
              ),
            )
          const wrong = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: original.refresh,
            client_id: id,
            client_secret: 'incorrect-secret',
          })
          expect(wrong.status).toBe(400)
          expect(wrong.json.error).toBe('invalid_client')
          expect(
            (
              await requestTools(
                ctx.site.slug,
                String(rotated.json.access_token),
              )
            ).status,
          ).toBe(200)
          const correct = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: original.refresh,
            client_id: id,
            client_secret: secret,
          })
          expect(correct.status).toBe(400)
          expect(correct.json.error).toBe('invalid_grant')
          expect(
            (
              await requestTools(
                ctx.site.slug,
                String(rotated.json.access_token),
              )
            ).status,
          ).toBe(401)
        })

        it('rejects oversized token bodies at the HTTP auth boundary', async () => {
          const response = await auth.handler(
            new Request(`${AUTH_BASE}/oauth2/token`, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: 'client_id=' + 'a'.repeat(65_536),
            }),
          )
          expect(response.status).toBe(413)
        })

        it('limits replay invalidation to its site and authenticates before invalidating', async () => {
          const id = await registerClient()
          const first = await connectApp({
            clientId: id,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'replay-first',
            allowGoLive: false,
          })
          const second = await connectApp({
            clientId: id,
            slug: other.site.slug,
            siteId: other.site.id,
            email: ownerEmail,
            state: 'replay-second',
            allowGoLive: false,
          })
          const rotated = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: first.refresh,
            client_id: id,
          })
          expect(rotated.status).toBe(200)
          await db
            .update(oauthRefreshToken)
            .set({ rotationReplayExpiresAt: new Date(Date.now() - 1000) })
            .where(
              and(
                eq(oauthRefreshToken.clientId, id),
                isNotNull(oauthRefreshToken.rotatedAt),
              ),
            )
          const wrong = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: first.refresh,
            client_id: await registerClient(),
          })
          expect(wrong.status).toBe(400)
          expect(
            (
              await requestTools(
                ctx.site.slug,
                String(rotated.json.access_token),
              )
            ).status,
          ).toBe(200)
          const invalidRequests: Record<string, string>[] = [
            { scope: 'email' },
            { resource: mcpResourceUrl(other.site.slug) },
          ]
          for (const invalid of invalidRequests) {
            const refused = await tokenRequest({
              grant_type: 'refresh_token',
              refresh_token: first.refresh,
              client_id: id,
              ...invalid,
            })
            expect(refused.status).toBe(400)
            expect(
              (
                await requestTools(
                  ctx.site.slug,
                  String(rotated.json.access_token),
                )
              ).status,
            ).toBe(200)
          }
          const replay = await tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: first.refresh,
            client_id: id,
          })
          expect(replay.status).toBe(400)
          expect(replay.json.error).toBe('invalid_grant')
          expect(
            (
              await requestTools(
                ctx.site.slug,
                String(rotated.json.access_token),
              )
            ).status,
          ).toBe(401)
          expect(
            (await requestTools(other.site.slug, second.access)).status,
          ).toBe(200)
        })

        it('cannot redeem an outstanding code after disconnect and reconnect', async () => {
          const id = await registerClient()
          const pkce = pkcePair()
          const loginQuery = await startAuthorization({
            clientId: id,
            slug: ctx.site.slug,
            pkce,
            state: 'outstanding-code',
          })
          const jar: Jar = new Map()
          const signIn = await authPost(
            '/sign-in/email',
            { email: ownerEmail, password: PASSWORD, oauth_query: loginQuery },
            jar,
          )
          cookiesAsHeaders(jar)
          const approved = await approveConsentRequest({
            query: new URL(String(signIn.json.url), AUTH_ORIGIN).search.slice(
              1,
            ),
            siteId: ctx.site.id,
            allowGoLive: false,
          })
          const code =
            new URL(approved.redirectTo).searchParams.get('code') ?? ''
          const [connection] = await db
            .select()
            .from(mcpConnection)
            .where(eq(mcpConnection.clientId, id))
          await revokeConnection({
            id: connection.id,
            siteId: ctx.site.id,
            actorId: ownerId,
            organizationId: ctx.org.id,
            canRevokeOthers: true,
          })
          await connectApp({
            clientId: id,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'after-outstanding',
            allowGoLive: false,
          })
          const exchange = await tokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: id,
            code_verifier: pkce.verifier,
          })
          expect(exchange.status).toBe(400)
          expect(exchange.json.error).toBe('invalid_grant')
        })

        it('does not change existing permissions if plugin consent fails', async () => {
          const id = await registerClient()
          await connectApp({
            clientId: id,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'permissions-original',
            allowGoLive: false,
          })
          const pkce = pkcePair()
          const query = await startAuthorization({
            clientId: id,
            slug: ctx.site.slug,
            pkce,
            state: 'failed-approval',
          })
          const jar: Jar = new Map()
          await authPost(
            '/sign-in/email',
            { email: ownerEmail, password: PASSWORD },
            jar,
          )
          cookiesAsHeaders(jar)
          const handler = vi
            .spyOn(auth, 'handler')
            .mockResolvedValueOnce(
              Response.json({ error: 'invalid_request' }, { status: 400 }),
            )
          try {
            await expect(
              approveConsentRequest({
                query,
                siteId: ctx.site.id,
                allowGoLive: true,
              }),
            ).rejects.toThrow()
          } finally {
            handler.mockRestore()
          }
          const [connection] = await db
            .select()
            .from(mcpConnection)
            .where(eq(mcpConnection.clientId, id))
          expect(connection.allowGoLive).toBe(false)
        })

        it('rejects multiple site resources before issuing consent', async () => {
          const id = await registerClient()
          const pkce = pkcePair()
          const params = new URLSearchParams({
            client_id: id,
            response_type: 'code',
            redirect_uri: REDIRECT_URI,
            scope: 'mcp offline_access',
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
          })
          params.append('resource', mcpResourceUrl(ctx.site.slug))
          params.append('resource', mcpResourceUrl(other.site.slug))
          const response = await auth.handler(
            new Request(`${AUTH_BASE}/oauth2/authorize?${params}`),
          )
          expect(response.status).toBe(400)
          expect((await response.json()).error).toBe('invalid_target')
          const tokenParams = new URLSearchParams({
            grant_type: 'authorization_code',
            code: 'unissued-code',
            client_id: id,
            redirect_uri: REDIRECT_URI,
          })
          tokenParams.append('resource', mcpResourceUrl(ctx.site.slug))
          tokenParams.append('resource', mcpResourceUrl(other.site.slug))
          const tokenResponse = await auth.handler(
            new Request(`${AUTH_BASE}/oauth2/token`, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: tokenParams,
            }),
          )
          expect(tokenResponse.status).toBe(400)
          expect(['invalid_target', 'invalid_request']).toContain(
            (await tokenResponse.json()).error,
          )
        })
      })

      describe('resource indicator (RFC 8707)', () => {
        it('accepts the resource on the authorize request only', async () => {
          const tokens = await connectApp({
            clientId,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'authorize-resource-only',
            allowGoLive: false,
            tokenResource: false,
          })
          const client = await mcpClient(ctx.site.slug, tokens.access)
          expect(await toolNames(client)).toContain('list_entries')
          await client.close()
        })

        it('refuses a token request for a different resource than the one authorized', async () => {
          const exchanged = await exchangeForApp({
            clientId,
            slug: ctx.site.slug,
            siteId: ctx.site.id,
            email: ownerEmail,
            state: 'resource-mismatch',
            allowGoLive: false,
            tokenResource: mcpResourceUrl(other.site.slug),
          })
          expect(exchanged.status).toBe(400)
          expect(exchanged.json.error).toBe('invalid_target')
        })
      })

      it('takes token requests as application/x-www-form-urlencoded and answers JSON', async () => {
        const fresh = await connectApp({
          clientId,
          slug: ctx.site.slug,
          siteId: ctx.site.id,
          email: ownerEmail,
          state: 'form-encoded',
          allowGoLive: false,
        })
        const response = await auth.handler(
          new Request(`${AUTH_BASE}/oauth2/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: fresh.refresh,
              client_id: clientId,
              resource: mcpResourceUrl(ctx.site.slug),
            }),
          }),
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain(
          'application/json',
        )
        const body = (await response.json()) as Record<string, unknown>
        expect(String(body.access_token).startsWith('areca_at_')).toBe(true)
        ownerAccess = String(body.access_token)
        ownerRefresh = String(body.refresh_token)
      })
    })

    describe('two-factor sign-in resumes the authorization', () => {
      it('continues through /oauth2/continue after the TOTP step', async () => {
        const tfa = await addUser('tfa', 'owner', { twoFactor: true })
        const clientId = await registerClient()
        const pkce = pkcePair()
        const loginQuery = await startAuthorization({
          clientId,
          slug: ctx.site.slug,
          pkce,
          state: 'tfa-state',
        })

        const jar: Jar = new Map()
        const challenged = await authPost(
          '/sign-in/email',
          { email: tfa.email, password: PASSWORD, oauth_query: loginQuery },
          jar,
        )
        expect(challenged.json.twoFactorRedirect).toBe(true)
        // No session yet: only the two-factor challenge cookie.
        expect(
          [...jar.keys()].some((name) => name.includes('session_token')),
        ).toBe(false)

        const verified = await authPost(
          '/two-factor/verify-totp',
          { code: totpNow(TOTP_SECRET) },
          jar,
        )
        expect(verified.status).toBe(200)
        expect(
          [...jar.keys()].some((name) => name.includes('session_token')),
        ).toBe(true)

        // The step the login page must make after TOTP: resume the request.
        const resumed = await authPost(
          '/oauth2/continue',
          { postLogin: true, oauth_query: loginQuery },
          jar,
        )
        expect(resumed.status).toBe(200)
        expect(String(resumed.json.url)).toContain('/oauth/consent?')
        const consentQuery = new URL(
          String(resumed.json.url),
          AUTH_ORIGIN,
        ).search.slice(1)

        cookiesAsHeaders(jar)
        const approved = await approveConsentRequest({
          query: consentQuery,
          siteId: ctx.site.id,
          allowGoLive: false,
        })
        const code = new URL(approved.redirectTo).searchParams.get('code') ?? ''
        const exchanged = await tokenRequest({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: pkce.verifier,
          resource: mcpResourceUrl(ctx.site.slug),
        })
        expect(exchanged.status).toBe(200)
        const client = await mcpClient(
          ctx.site.slug,
          String(exchanged.json.access_token),
        )
        expect(await toolNames(client)).toContain('list_entries')
        await client.close()
      })
    })
  },
)
