import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as StartServer from '@tanstack/react-start/server'

import { db } from '#/db'
import {
  account,
  membership,
  oauthClient,
  oauthResource,
  verification,
} from '#/db/schema'
import { env } from '#/env'
import { auth } from '#/lib/auth'
import { cleanupTestSite, createTestSite } from '#/server/content/test-utils'
import { approveConsentRequest } from './consent'
import { handleSiteMcpRequest } from './http'
import { mcpResourceUrl } from './oauth-resource'

vi.hoisted(() => {
  process.env.AUTH_EMAIL_PASSWORD_ENABLED = 'true'
  process.env.WORKER_ENABLED = 'false'
})
const requestState = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof StartServer>()),
  getRequestHeaders: () => requestState.headers,
}))

const AUTH_ORIGIN = new URL(env.BETTER_AUTH_URL).origin
const AUTH_BASE = `${AUTH_ORIGIN}/api/auth`
const REDIRECT_URI = 'http://localhost:19999/callback'
const PASSWORD = 'Correct-horse-battery-1'
const hasDb = Boolean(process.env.DATABASE_URL)
const replayIdentifiers = new Set<string>()

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  })
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) }
}

function proof(
  key: { privateKey: KeyObject; jwk: JsonWebKey },
  url: string,
  options: {
    token?: string
    method?: string
    claims?: Record<string, unknown>
  } = {},
) {
  const header = Buffer.from(
    JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: key.jwk }),
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      htu: url,
      htm: options.method ?? 'POST',
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      ...(options.token
        ? {
            ath: createHash('sha256').update(options.token).digest('base64url'),
          }
        : {}),
      ...options.claims,
    }),
  ).toString('base64url')
  const { htm, htu, jti } = JSON.parse(
    Buffer.from(payload, 'base64url').toString(),
  ) as { htm: string; htu: string; jti: string }
  const { crv, kty, x, y } = key.jwk
  const jkt = createHash('sha256')
    .update(JSON.stringify({ crv, kty, x, y }))
    .digest('base64url')
  const target = new URL(htu)
  const replayKey = createHash('sha256')
    .update(
      `${jkt}\n${htm.toUpperCase()}\n${target.origin}${target.pathname}\n${jti}`,
    )
    .digest('base64url')
  replayIdentifiers.add(`dpop-proof:${replayKey}`)
  const input = `${header}.${payload}`
  const signature = sign('sha256', Buffer.from(input), {
    key: key.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `${input}.${signature}`
}

async function authPost(
  path: string,
  body: unknown,
  headers: HeadersInit = {},
) {
  const response = await auth.handler(
    new Request(`${AUTH_BASE}${path}`, {
      method: 'POST',
      headers: {
        origin: AUTH_ORIGIN,
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
  return { response, json: (await response.json()) as Record<string, unknown> }
}

// Full authorization-code exchange, not a seeded access-token row: the AS must
// actually bind cnf.jkt and preserve it through refresh before the RS verifies it.
describe.skipIf(!hasDb)('MCP DPoP sender-constrained OAuth requests', () => {
  let ctx: Awaited<ReturnType<typeof createTestSite>>
  let clientId = ''
  let accessToken = ''
  let refreshToken = ''
  let bearerAccess = ''
  const key = keyPair()
  const otherKey = keyPair()

  beforeAll(async () => {
    ctx = await createTestSite()
    await db.insert(membership).values({
      userId: ctx.actor.id,
      organizationId: ctx.org.id,
      role: 'owner',
    })
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: ctx.actor.id,
      providerId: 'credential',
      userId: ctx.actor.id,
      password: await hashPassword(PASSWORD),
    })
    const registered = await authPost('/oauth2/register', {
      client_name: `DPoP regression ${ctx.suffix}`,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp offline_access',
    })
    clientId = String(registered.json.client_id)
    expect(registered.response.status).toBe(201)
    const bound = await mint(true)
    expect(bound.token_type).toBe('DPoP')
    accessToken = String(bound.access_token)
    refreshToken = String(bound.refresh_token)
    bearerAccess = String((await mint(false)).access_token)
  })

  afterAll(async () => {
    if (clientId)
      await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
    {
      await db
        .delete(oauthResource)
        .where(eq(oauthResource.identifier, mcpResourceUrl(ctx.site.slug)))
      await cleanupTestSite(ctx)
    }
    for (const identifier of replayIdentifiers)
      await db
        .delete(verification)
        .where(eq(verification.identifier, identifier))
  })

  async function mint(dpop: boolean, scope = 'mcp offline_access') {
    const verifier = randomBytes(32).toString('base64url')
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state: crypto.randomUUID(),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope,
      resource: mcpResourceUrl(ctx.site.slug),
    })
    const authorization = await auth.handler(
      new Request(`${AUTH_BASE}/oauth2/authorize?${query}`, {
        headers: { accept: 'text/html' },
      }),
    )
    expect(authorization.status).toBe(302)
    const signed = new URL(
      authorization.headers.get('location') ?? '',
      AUTH_ORIGIN,
    ).search.slice(1)
    const login = await authPost('/sign-in/email', {
      email: ctx.actor.email,
      password: PASSWORD,
      oauth_query: signed,
    })
    expect(login.response.status).toBe(200)
    const cookies = login.response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    requestState.headers = new Headers({ cookie: cookies })
    const next = new URL(String(login.json.url), AUTH_ORIGIN)
    const redirectTo = next.pathname.endsWith('/oauth/consent')
      ? (
          await approveConsentRequest({
            query: next.search.slice(1),
            siteId: ctx.site.id,
            allowGoLive: false,
          })
        ).redirectTo
      : next.href
    const response = await tokenRequest(
      {
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code: new URL(redirectTo).searchParams.get('code') ?? '',
        code_verifier: verifier,
        resource: mcpResourceUrl(ctx.site.slug),
      },
      dpop ? proof(key, `${AUTH_BASE}/oauth2/token`) : undefined,
    )
    expect(response.status).toBe(200)
    return response.json
  }

  async function tokenRequest(params: Record<string, string>, dpop?: string) {
    const response = await auth.handler(
      new Request(`${AUTH_BASE}/oauth2/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(dpop ? { DPoP: dpop } : {}),
        },
        body: new URLSearchParams(params),
      }),
    )
    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>,
    }
  }

  async function mcp(
    token: string,
    dpop?: string,
    scheme = 'DPoP',
    url?: string,
  ) {
    return handleSiteMcpRequest(
      new Request(url ?? mcpResourceUrl(ctx.site.slug), {
        method: 'POST',
        headers: {
          Authorization: `${scheme} ${token}`,
          ...(dpop ? { DPoP: dpop } : {}),
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      }),
      ctx.site.slug,
    )
  }

  it('accepts a fresh signed proof, including through an internal proxy URL', async () => {
    const response = await mcp(
      accessToken,
      proof(key, mcpResourceUrl(ctx.site.slug), { token: accessToken }),
      'dpop',
      `http://internal:3000/api/mcp/${ctx.site.slug}?ignored=query`,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('tools')
  })

  it('rejects a bound token passed as Bearer or without a proof', async () => {
    expect((await mcp(accessToken, undefined, 'Bearer')).status).toBe(401)
    const missing = await mcp(accessToken)
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toContain('DPoP')
    expect(missing.headers.get('www-authenticate')).toContain(
      'invalid_dpop_proof',
    )
  })

  it.each([
    'key',
    'method',
    'url',
    'ath',
    'stale',
    'future',
    'jti',
    'private-jwk',
    'missing-ath',
    'signature',
  ])('rejects wrong %s proof', async (failure) => {
    const claims: Record<string, unknown> =
      failure === 'ath'
        ? { ath: 'wrong-token-hash' }
        : failure === 'stale'
          ? { iat: Math.floor(Date.now() / 1000) - 61 }
          : failure === 'future'
            ? { iat: Math.floor(Date.now() / 1000) + 60 }
            : failure === 'jti'
              ? { jti: '' }
              : {}
    const chosenKey =
      failure === 'key'
        ? otherKey
        : failure === 'private-jwk'
          ? { ...key, jwk: key.privateKey.export({ format: 'jwk' }) }
          : key
    const dpop = proof(
      chosenKey,
      failure === 'url'
        ? `${mcpResourceUrl(ctx.site.slug)}/other`
        : mcpResourceUrl(ctx.site.slug),
      {
        token: failure === 'missing-ath' ? undefined : accessToken,
        method: failure === 'method' ? 'GET' : 'POST',
        claims,
      },
    )
    expect(
      (
        await mcp(
          accessToken,
          failure === 'signature' ? `${dpop.slice(0, -5)}xxxxx` : dpop,
        )
      ).status,
    ).toBe(401)
  })

  it('atomically rejects concurrent reuse with persisted reservations', async () => {
    const dpop = proof(key, mcpResourceUrl(ctx.site.slug), {
      token: accessToken,
    })
    const responses = await Promise.all([
      mcp(accessToken, dpop),
      mcp(accessToken, dpop),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ])
    expect((await mcp(accessToken, dpop)).status).toBe(401)
    const persisted = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, [...replayIdentifiers].at(-1) ?? ''))
    expect(persisted).toHaveLength(1)
  })

  it('rejects replay at the inclusive proof-age boundary', async () => {
    const at = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(at)
    try {
      const dpop = proof(key, mcpResourceUrl(ctx.site.slug), {
        token: accessToken,
        claims: { iat: Math.floor(at / 1000) - 60 },
      })
      expect((await mcp(accessToken, dpop)).status).toBe(200)
      expect((await mcp(accessToken, dpop)).status).toBe(401)
    } finally {
      clock.mockRestore()
    }
  })

  it('fails closed when the persistent replay store is unavailable', async () => {
    const context = await auth.$context
    const reservation = vi
      .spyOn(context.internalAdapter, 'reserveVerificationValue')
      .mockRejectedValueOnce(new Error('database unavailable'))
    try {
      expect(
        (
          await mcp(
            accessToken,
            proof(key, mcpResourceUrl(ctx.site.slug), { token: accessToken }),
          )
        ).status,
      ).toBe(401)
    } finally {
      reservation.mockRestore()
    }
  })

  it('keeps ordinary Bearer tokens working and rejects their use as DPoP', async () => {
    expect((await mcp(bearerAccess, undefined, 'bearer')).status).toBe(200)
    expect(
      (
        await mcp(
          bearerAccess,
          proof(key, mcpResourceUrl(ctx.site.slug), { token: bearerAccess }),
        )
      ).status,
    ).toBe(401)
  })

  it('refreshes with the same key, rejects missing or other keys, and retains binding', async () => {
    const params = {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }
    expect((await tokenRequest(params)).status).toBe(400)
    expect(
      (await tokenRequest(params, proof(otherKey, `${AUTH_BASE}/oauth2/token`)))
        .status,
    ).toBe(400)
    const refreshProof = proof(key, `${AUTH_BASE}/oauth2/token`)
    const refreshed = await tokenRequest(params, refreshProof)
    expect(refreshed.status).toBe(200)
    expect(refreshed.json.token_type).toBe('DPoP')
    expect((await tokenRequest(params, refreshProof)).status).toBe(400)
    const next = String(refreshed.json.access_token)
    expect((await mcp(next, undefined, 'Bearer')).status).toBe(401)
    expect(
      (
        await mcp(
          next,
          proof(key, mcpResourceUrl(ctx.site.slug), { token: next }),
        )
      ).status,
    ).toBe(200)
  })

  it('returns a DPoP insufficient-scope challenge for an authenticated bound token', async () => {
    const limited = String((await mint(true, 'offline_access')).access_token)
    const response = await mcp(
      limited,
      proof(key, mcpResourceUrl(ctx.site.slug), { token: limited }),
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toMatch(/^DPoP /)
    expect(response.headers.get('www-authenticate')).toContain(
      'insufficient_scope',
    )
  })
})
