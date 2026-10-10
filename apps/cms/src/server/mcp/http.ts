/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { createMcpHandler } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import {
  DPOP_SIGNING_ALGORITHMS,
  parseAccessTokenAuthorization,
} from 'better-auth/oauth2'

import { db } from '#/db'
import { site, user } from '#/db/schema'
import { createLogger } from '#/server/log'
import { bearerToken } from '#/server/http/bearer-token'

import { findUsableConnection, touchConnection } from './connections'
import type { McpActor } from './keys'
import { liveRoleFor, resolveMcpActorResult, MCP_KEY_PREFIX } from './keys'
import {
  MCP_CHALLENGE_SCOPES,
  MCP_SCOPE,
  mcpResourceUrl,
} from './oauth-resource'
import { verifyMcpAccessToken } from './oauth-tokens'
import { createArecaMcpServer } from './server'

const log = createLogger('mcp')

/** Largest JSON-RPC body accepted; a 1 MB entry plus Markdown fits well inside. */
const MAX_REQUEST_BODY_BYTES = 1_048_576

const handler = createMcpHandler(
  (ctx: McpRequestContext) => createArecaMcpServer(actorFrom(ctx)),
  {
    legacy: 'stateless',
    responseMode: 'json',
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    onerror: (error) => log.warn('MCP protocol error', { err: error }),
  },
)

/** The actor travels in authInfo.extra, set per request after authentication. */
function actorFrom(ctx: McpRequestContext): McpActor {
  const actor = ctx.authInfo?.extra?.actor
  if (!isActor(actor)) {
    throw new Error(
      'MCP request reached the server without an authenticated actor',
    )
  }
  return actor
}

function isActor(value: unknown): value is McpActor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'keyId' in value &&
    'siteId' in value &&
    'role' in value
  )
}

export const MFA_REQUIRED_MESSAGE =
  'Your account needs two-factor authentication before AI keys work. Turn it on in Account settings.'

function mfaRequired(): Response {
  return Response.json(
    { error: MFA_REQUIRED_MESSAGE, code: 'mfa_required' },
    { status: 403 },
  )
}

function unauthorized(): Response {
  return Response.json(
    { error: 'Invalid or expired Areca MCP key' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="areca-mcp"' },
    },
  )
}

/** Where a client finds the site's authorization server (RFC 9728). */
export function protectedResourceMetadataUrl(siteSlug: string): string {
  const resource = new URL(mcpResourceUrl(siteSlug))
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`
}

/**
 * The RFC 6750 / RFC 9728 challenge. Every 401 for the per-site endpoint
 * carries `resource_metadata`, which is how a client that has no token yet
 * discovers how to sign in.
 */
function challengeHeader(
  siteSlug: string,
  params: {
    error?: string
    description?: string
    scope?: string
    dpop?: boolean
  } = {},
): string {
  const parts: string[] = []
  if (params.error) parts.push(`error="${params.error}"`)
  if (params.description)
    parts.push(`error_description="${params.description}"`)
  parts.push(`resource_metadata="${protectedResourceMetadataUrl(siteSlug)}"`)
  parts.push(`scope="${params.scope ?? MCP_CHALLENGE_SCOPES.join(' ')}"`)
  if (params.dpop) parts.push(`algs="${DPOP_SIGNING_ALGORITHMS.join(' ')}"`)
  return `${params.dpop ? 'DPoP' : 'Bearer'} ${parts.join(', ')}`
}

function challenge401(
  siteSlug: string,
  params: { error?: string; description?: string; dpop?: boolean } = {},
): Response {
  return Response.json(
    { error: params.description ?? 'Sign in to connect to this site' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': challengeHeader(siteSlug, params) },
    },
  )
}

function insufficientScope(siteSlug: string, dpop = false): Response {
  return Response.json(
    { error: 'This connection is not allowed to use the site' },
    {
      status: 403,
      headers: {
        'WWW-Authenticate': challengeHeader(siteSlug, {
          error: 'insufficient_scope',
          scope: MCP_SCOPE,
          dpop,
        }),
      },
    },
  )
}

function unknownSite(): Response {
  return Response.json({ error: 'Site not found' }, { status: 404 })
}

/**
 * Serves one MCP request for the site the bearer key belongs to. Every
 * request is authenticated again, so a revoked or expired key stops working
 * at once even for an open session.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const token = bearerToken(request)
  if (!token?.startsWith(MCP_KEY_PREFIX)) return unauthorized()
  const resolution = await resolveMcpActorResult(token)
  if (!resolution.ok) {
    return resolution.reason === 'mfa_required' ? mfaRequired() : unauthorized()
  }
  return runMcp(request, resolution.actor, {
    clientId: resolution.actor.keyId,
    scopes: [],
  })
}

/**
 * The per-site connector endpoint `/api/mcp/<slug>`. Two credentials work:
 *   - a personal key (`areca_mcp_…`) whose site must be this site;
 *   - an OAuth access token issued for this site's resource, from an app the
 *     user connected to this site, acting as that user with their live role.
 */
export async function handleSiteMcpRequest(
  request: Request,
  siteSlug: string,
): Promise<Response> {
  const [found] = await db
    .select()
    .from(site)
    .where(eq(site.slug, siteSlug))
    .limit(1)
  if (!found) return unknownSite()

  const authorization = parseAccessTokenAuthorization(
    request.headers.get('authorization'),
  )
  const token =
    authorization?.scheme === 'Bearer' || authorization?.scheme === 'DPoP'
      ? authorization.token
      : null
  if (!token) return challenge401(siteSlug)

  if (token.startsWith(MCP_KEY_PREFIX)) {
    if (authorization?.scheme !== 'Bearer')
      return challenge401(siteSlug, {
        error: 'invalid_token',
        dpop: true,
        description: 'Personal keys require Bearer authorization',
      })
    const resolution = await resolveMcpActorResult(token)
    if (!resolution.ok) {
      return resolution.reason === 'mfa_required'
        ? mfaRequired()
        : challenge401(siteSlug, {
            error: 'invalid_token',
            description: 'Invalid or expired key',
          })
    }
    if (resolution.actor.siteId !== found.id) {
      // A key for another site is a valid key here but not for this resource.
      return challenge401(siteSlug, {
        error: 'invalid_token',
        description: 'Key is for a different site',
      })
    }
    return runMcp(request, resolution.actor, {
      clientId: resolution.actor.keyId,
      scopes: [],
    })
  }

  const verdict = await verifyMcpAccessToken(
    token,
    request,
    mcpResourceUrl(siteSlug),
  )
  if (!verdict.ok) {
    return challenge401(siteSlug, {
      error: verdict.error ?? 'invalid_token',
      dpop: verdict.dpop || authorization?.scheme === 'DPoP',
      description:
        verdict.error === 'invalid_dpop_proof'
          ? 'DPoP proof is missing, invalid or already used'
          : 'Access token is invalid or expired',
    })
  }
  const { userId, clientId, connectionId, resources, scopes } = verdict.token
  // RFC 8707: a token only works at the resource it was issued for.
  if (!resources.includes(mcpResourceUrl(siteSlug))) {
    return challenge401(siteSlug, {
      error: 'invalid_token',
      description: 'Access token was issued for a different site',
      dpop: authorization?.scheme === 'DPoP',
    })
  }
  if (!scopes.includes(MCP_SCOPE))
    return insufficientScope(siteSlug, authorization?.scheme === 'DPoP')

  const connection = await findUsableConnection({
    userId,
    siteId: found.id,
    clientId,
  })
  if (!connection || connection.id !== connectionId) {
    return challenge401(siteSlug, {
      error: 'invalid_token',
      description: 'This app is no longer connected to the site',
      dpop: authorization?.scheme === 'DPoP',
    })
  }

  const [owner] = await db
    .select({
      id: user.id,
      name: user.name,
      isAgencyAdmin: user.isAgencyAdmin,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!owner) {
    return challenge401(siteSlug, {
      error: 'invalid_token',
      dpop: authorization?.scheme === 'DPoP',
    })
  }
  const live = await liveRoleFor(owner, found.organizationId)
  if (!live.ok) {
    return live.reason === 'mfa_required'
      ? mfaRequired()
      : challenge401(siteSlug, {
          error: 'invalid_token',
          description: 'You no longer have access to this site',
          dpop: authorization?.scheme === 'DPoP',
        })
  }

  const actor: McpActor = {
    keyId: connection.id,
    keyName: connection.clientName,
    credential: 'oauth',
    userId: owner.id,
    userName: owner.name,
    siteId: found.id,
    siteSlug: found.slug,
    siteName: found.name,
    organizationId: found.organizationId,
    role: live.role,
    allowGoLive: connection.allowGoLive && live.role !== 'editor',
  }
  const response = await runMcp(request, actor, { clientId, scopes })
  if (await isSuccessfulMcpResponse(response)) await touchConnection(connection)
  return response
}

function runMcp(
  request: Request,
  actor: McpActor,
  auth: { clientId: string; scopes: string[] },
): Promise<Response> {
  return handler.fetch(request, {
    authInfo: {
      // Never the secret: the connection or key id is enough for logs and audit.
      token: actor.keyId,
      clientId: auth.clientId,
      scopes: auth.scopes,
      extra: { actor },
    },
  })
}

/** Only successful protocol results keep the approval's idle window alive. */
async function isSuccessfulMcpResponse(response: Response): Promise<boolean> {
  if (!response.ok) return false
  try {
    const text = await response.clone().text()
    const bodies: unknown[] = response.headers
      .get('content-type')
      ?.includes('text/event-stream')
      ? text
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => JSON.parse(line.slice(5)))
      : [JSON.parse(text)]
    const results: unknown[] = bodies.flatMap((body) =>
      Array.isArray(body) ? body : [body],
    )
    return results.some((item: unknown) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('result' in item) ||
        'error' in item
      )
        return false
      const result = item.result
      return (
        !result ||
        typeof result !== 'object' ||
        !('isError' in result) ||
        result.isError !== true
      )
    })
  } catch {
    return false
  }
}
