/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { eq } from 'drizzle-orm'
import { DPOP_SIGNING_ALGORITHMS } from 'better-auth/oauth2'

import { db } from '#/db'
import { site } from '#/db/schema'
import { auth } from '#/lib/auth'
import { createLogger } from '#/server/log'

import { MCP_OAUTH_SCOPES, mcpResourceUrl } from './oauth-resource'

const log = createLogger('mcp-discovery')

const RESOURCE_DOC_PREFIX = '/.well-known/oauth-protected-resource'
const AS_DOC_PREFIX = '/.well-known/oauth-authorization-server'
const OIDC_DOC_PREFIX = '/.well-known/openid-configuration'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '600',
}

const DOC_CACHE_CONTROL = 'public, max-age=300'

/**
 * Discovery documents served from the origin root (RFC 8414, OIDC Discovery,
 * RFC 9728). Clients build these URLs from the issuer or the resource, so each
 * path must match what the document itself says:
 *   - the issuer is `${BETTER_AUTH_URL}/api/auth`, so the AS metadata lives at
 *     `/.well-known/oauth-authorization-server/api/auth` (path insertion) and
 *     the OIDC document at `/.well-known/openid-configuration/api/auth`.
 *     The plugin also serves `/api/auth/.well-known/...` under the auth handler.
 *   - the protected resource for a site is `${APP_URL}/api/mcp/<slug>`, so its
 *     PRM document lives at `/.well-known/oauth-protected-resource/api/mcp/<slug>`.
 * The bare root paths (`/.well-known/oauth-authorization-server` and
 * `/.well-known/openid-configuration`) serve the same JSON as the path-inserted
 * documents: clients that probe the origin root still get the issuer they were
 * given, `${BETTER_AUTH_URL}/api/auth`, so the issuer is never rewritten.
 */
export async function handleDiscoveryRequest(
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith('/.well-known/')) return null

  if (request.method === 'OPTIONS') {
    return isDiscoveryPath(path)
      ? new Response(null, { status: 204, headers: CORS_HEADERS })
      : null
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  if (!isDiscoveryPath(path)) return null
  const response = await respond(path)
  if (!response) return null
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    })
  }
  return response
}

function isDiscoveryPath(path: string): boolean {
  return (
    path.startsWith(`${RESOURCE_DOC_PREFIX}/`) ||
    path.startsWith(`${AS_DOC_PREFIX}/`) ||
    path.startsWith(`${OIDC_DOC_PREFIX}/`) ||
    path === AS_DOC_PREFIX ||
    path === OIDC_DOC_PREFIX
  )
}

async function respond(path: string): Promise<Response | null> {
  try {
    if (path.startsWith(`${RESOURCE_DOC_PREFIX}/`)) {
      return await resourceDocument(path)
    }
    const metadata = await auth.api.getOAuthServerConfig()
    const issuerPath = new URL(metadata.issuer).pathname.replace(/\/+$/, '')
    if (!issuerPath) return null

    if (path === `${AS_DOC_PREFIX}${issuerPath}` || path === AS_DOC_PREFIX) {
      return json(metadata)
    }
    if (
      path === `${OIDC_DOC_PREFIX}${issuerPath}` ||
      path === OIDC_DOC_PREFIX
    ) {
      return json(await auth.api.getOpenIdConfig())
    }
    return null
  } catch (error) {
    log.error('discovery document failed', { err: error })
    return null
  }
}

/** PRM for `/.well-known/oauth-protected-resource/<resource path>`. */
async function resourceDocument(path: string): Promise<Response> {
  const resourcePath = path.slice(RESOURCE_DOC_PREFIX.length)
  const match = /\/api\/mcp\/([a-z0-9][a-z0-9-]*)$/.exec(resourcePath)
  const slug = match?.[1] ?? null
  // The path must be exactly the resource's own path (APP_URL origin + path),
  // so the document is served only at the URL the client derives from it.
  const exact =
    slug !== null && new URL(mcpResourceUrl(slug)).pathname === resourcePath
  const [found] =
    exact && slug
      ? await db
          .select({ name: site.name, slug: site.slug })
          .from(site)
          .where(eq(site.slug, slug))
          .limit(1)
      : []
  if (!found) return notFound()
  const issuer = (await auth.api.getOAuthServerConfig()).issuer

  return json({
    resource: mcpResourceUrl(found.slug),
    authorization_servers: [issuer],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    dpop_signing_alg_values_supported: [...DPOP_SIGNING_ALGORITHMS],
    resource_name: `${found.name} (Areca CMS)`,
  })
}

function json(body: unknown): Response {
  return Response.json(body, {
    headers: { ...CORS_HEADERS, 'Cache-Control': DOC_CACHE_CONTROL },
  })
}

function notFound(): Response {
  return Response.json(
    { error: 'not_found' },
    { status: 404, headers: CORS_HEADERS },
  )
}
