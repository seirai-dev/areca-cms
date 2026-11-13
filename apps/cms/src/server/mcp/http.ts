/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { createMcpHandler } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import {
  DPOP_SIGNING_ALGORITHMS,
  parseAccessTokenAuthorization,
} from 'better-auth/oauth2'

import { db } from '#/db'
import { isDevSite } from '#/server/security/site-visibility'
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
import { isSiteContext, loadSiteContext } from './site-context'
import type { McpSiteContext } from './site-context'
import { siteCoreColumns } from '#/server/content/site-core'

const log = createLogger('mcp')

/** Largest JSON-RPC body accepted; a 1 MB entry plus Markdown fits well inside. */
const MAX_REQUEST_BODY_BYTES = 1_048_576

/** Transport settings shared by the per-site and agency connectors. */
export const MCP_TRANSPORT_OPTIONS = {
  legacy: 'stateless',
  responseMode: 'json',
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  onerror: (error: unknown) => log.warn('MCP protocol error', { err: error }),
} as const

const handler = createMcpHandler(
  (ctx: McpRequestContext) =>
    createArecaMcpServer(actorFrom(ctx), siteFrom(ctx)),
  MCP_TRANSPORT_OPTIONS,
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

/** The site's environment, set per request next to the actor. */
function siteFrom(ctx: McpRequestContext): McpSiteContext {
  const context = ctx.authInfo?.extra?.site
  if (!isSiteContext(context)) {
    throw new Error('MCP request reached the server without a site context')
  }
  return context
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

export function mfaRequired(): Response {
  return Response.json(
    { error: MFA_REQUIRED_MESSAGE, code: 'mfa_required' },
    { status: 403 },
  )
}

export function unauthorized(): Response {
  return Response.json(
    { error: 'Invalid or expired Areca MCP key' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="areca-mcp"' },
    },
  )
}

/** Where a client finds the authorization server for a resource (RFC 9728). */
export function protectedResourceMetadataUrlFor(resource: string): string {
  const url = new URL(resource)
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`
}

/** Where a client finds the site's authorization server (RFC 9728). */
export function protectedResourceMetadataUrl(siteSlug: string): string {
  return protectedResourceMetadataUrlFor(mcpResourceUrl(siteSlug))
}

export type ChallengeParams = {
  error?: string
  description?: string
  scope?: string
  dpop?: boolean
}

/**
 * The RFC 6750 / RFC 9728 challenge for a resource's metadata URL. Every 401
 * carries `resource_metadata`, which is how a client that has no token yet
 * discovers how to sign in.
 */
export function challengeHeaderAt(
  metadataUrl: string,
  params: ChallengeParams = {},
): string {
  const parts: string[] = []
  if (params.error) parts.push(`error="${params.error}"`)
  if (params.description)
    parts.push(`error_description="${params.description}"`)
  parts.push(`resource_metadata="${metadataUrl}"`)
  parts.push(`scope="${params.scope ?? MCP_CHALLENGE_SCOPES.join(' ')}"`)
  if (params.dpop) parts.push(`algs="${DPOP_SIGNING_ALGORITHMS.join(' ')}"`)
  return `${params.dpop ? 'DPoP' : 'Bearer'} ${parts.join(', ')}`
}

/**
 * The 401 and 403 answers of one MCP resource. Both name the resource's
 * metadata URL, so a client finds how to sign in; `copy` is the body text a
 * 401 without a description, and a 403, carry.
 */
export function mcpChallenges(
  metadataUrl: () => string,
  copy: { signIn: string; insufficientScope: string },
) {
  return {
    challenge401(
      params: ChallengeParams & { message?: string } = {},
    ): Response {
      const { message, ...challenge } = params
      return Response.json(
        { error: message ?? challenge.description ?? copy.signIn },
        {
          status: 401,
          headers: {
            'WWW-Authenticate': challengeHeaderAt(metadataUrl(), challenge),
          },
        },
      )
    },
    insufficientScope(dpop = false): Response {
      return Response.json(
        { error: copy.insufficientScope },
        {
          status: 403,
          headers: {
            'WWW-Authenticate': challengeHeaderAt(metadataUrl(), {
              error: 'insufficient_scope',
              scope: MCP_SCOPE,
              dpop,
            }),
          },
        },
      )
    },
  }
}

export function unknownSite(): Response {
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
 *
 * Development environments (docs/design/dev-environments.md, Decision 3,
 * Decision 7) answer exactly like a missing slug, the `unknownSite()` 404, to
 * every caller who is not an agency admin. Unauthenticated requests still get
 * the 401 challenge, because OAuth needs it to start; the trade-off is that
 * the 401 (and the discovery document) reveal that a `-dev` slug exists.
 */
export async function handleSiteMcpRequest(
  request: Request,
  siteSlug: string,
): Promise<Response> {
  const [found] = await db
    .select(siteCoreColumns)
    .from(site)
    .where(eq(site.slug, siteSlug))
    .limit(1)
  if (!found) return unknownSite()
  const devEnv = isDevSite(found)
  const { challenge401, insufficientScope } = mcpChallenges(
    () => protectedResourceMetadataUrl(siteSlug),
    {
      signIn: 'Sign in to connect to this site',
      insufficientScope: 'This connection is not allowed to use the site',
    },
  )

  const authorization = parseAccessTokenAuthorization(
    request.headers.get('authorization'),
  )
  const token =
    authorization?.scheme === 'Bearer' || authorization?.scheme === 'DPoP'
      ? authorization.token
      : null
  if (!token) return challenge401()

  if (token.startsWith(MCP_KEY_PREFIX)) {
    if (authorization?.scheme !== 'Bearer')
      return challenge401({
        error: 'invalid_token',
        dpop: true,
        description: 'Personal keys require Bearer authorization',
      })
    const resolution = await resolveMcpActorResult(token)
    if (!resolution.ok) {
      // mfa_required is only ever reported for an agency admin's key.
      return resolution.reason === 'mfa_required'
        ? mfaRequired()
        : challenge401({
            error: 'invalid_token',
            description: 'Invalid or expired key',
          })
    }
    if (resolution.actor.siteId !== found.id) {
      // A key for another site is a valid key here but not for this resource.
      // On a dev env the answer must not depend on the dev env existing.
      return devEnv
        ? unknownSite()
        : challenge401({
            error: 'invalid_token',
            description: 'Key is for a different site',
          })
    }
    // A dev env answers NotFound to everyone but agency admins (Decision 3).
    if (devEnv && resolution.actor.role !== 'agency') {
      return unknownSite()
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
    return challenge401({
      error: verdict.error ?? 'invalid_token',
      dpop: verdict.dpop || authorization?.scheme === 'DPoP',
      description:
        verdict.error === 'invalid_dpop_proof'
          ? 'DPoP proof is missing, invalid or already used'
          : 'Access token is invalid or expired',
    })
  }
  const { userId, clientId, connectionId, resources, scopes } = verdict.token
  const dpop = authorization?.scheme === 'DPoP'

  const [owner] = await db
    .select({
      id: user.id,
      name: user.name,
      isAgencyAdmin: user.isAgencyAdmin,
      twoFactorEnabled: user.twoFactorEnabled,
      blockedAt: user.blockedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!owner) {
    return challenge401({ error: 'invalid_token', dpop })
  }
  // The token is verified from here on, so the caller is known. On a dev env
  // every refusal from here is the missing-slug NotFound, unless the caller is
  // an agency admin, who keeps the normal answers.
  const refuse = (respond: () => Response) =>
    devEnv && !owner.isAgencyAdmin ? unknownSite() : respond()

  // RFC 8707: a token only works at the resource it was issued for.
  if (!resources.includes(mcpResourceUrl(siteSlug))) {
    return refuse(() =>
      challenge401({
        error: 'invalid_token',
        description: 'Access token was issued for a different site',
        dpop,
      }),
    )
  }
  if (!scopes.includes(MCP_SCOPE)) return refuse(() => insufficientScope(dpop))

  const connection = await findUsableConnection({
    userId,
    siteId: found.id,
    clientId,
  })
  if (!connection || connection.id !== connectionId) {
    return refuse(() =>
      challenge401({
        error: 'invalid_token',
        description: 'This app is no longer connected to the site',
        dpop,
      }),
    )
  }

  const live = await liveRoleFor(owner, found.organizationId)
  if (!live.ok) {
    return live.reason === 'mfa_required'
      ? mfaRequired()
      : refuse(() =>
          challenge401({
            error: 'invalid_token',
            description: 'You no longer have access to this site',
            dpop,
          }),
        )
  }

  const actor: McpActor = {
    keyId: connection.id,
    keyName: connection.clientName,
    credential: 'oauth',
    scope: 'site',
    userId: owner.id,
    userName: owner.name,
    siteId: found.id,
    siteSlug: found.slug,
    siteName: found.name,
    organizationId: found.organizationId,
    role: live.role,
    allowGoLive: connection.allowGoLive && live.role !== 'editor',
  }
  if (devEnv && actor.role !== 'agency') return unknownSite()
  const response = await runMcp(request, actor, { clientId, scopes })
  if (await isSuccessfulMcpResponse(response)) await touchConnection(connection)
  return response
}

async function runMcp(
  request: Request,
  actor: McpActor,
  auth: { clientId: string; scopes: string[] },
): Promise<Response> {
  const siteContext = await loadSiteContext(actor.siteId)
  // Last check for every credential: a development environment is agency-only (Decision 3).
  if (siteContext.environment === 'development' && actor.role !== 'agency') {
    return unknownSite()
  }
  return handler.fetch(request, {
    authInfo: {
      // Never the secret: the connection or key id is enough for logs and audit.
      token: actor.keyId,
      clientId: auth.clientId,
      scopes: auth.scopes,
      extra: { actor, site: siteContext },
    },
  })
}

/** Only successful protocol results keep the approval's idle window alive. */
export async function isSuccessfulMcpResponse(
  response: Response,
): Promise<boolean> {
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
