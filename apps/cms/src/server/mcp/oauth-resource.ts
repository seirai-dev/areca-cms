/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { oauthResource, site } from '#/db/schema'
import { env } from '#/env'

/**
 * OAuth constants and per-site protected-resource helpers. Kept free of the
 * Better Auth instance so `lib/auth.ts` can import them without a cycle.
 */

/**
 * Scopes the authorization server issues. `mcp` is the only scope the MCP
 * endpoints check. The OpenID scopes and `offline_access` are accepted and
 * advertised because common MCP clients request them by default (refresh
 * tokens need `offline_access`). Identity claims are not used for access.
 */
export const MCP_SCOPE = 'mcp'
export const MCP_OAUTH_SCOPES = [
  MCP_SCOPE,
  'openid',
  'profile',
  'email',
  'offline_access',
] as const

/** Scopes named in the 401 challenge: what a client must ask for to get in. */
export const MCP_CHALLENGE_SCOPES = [MCP_SCOPE, 'offline_access'] as const

export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60
/** Refresh tokens rotate on every use and expire 90 days after the last use. */
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60
/**
 * Seconds after a refresh token rotates during which presenting it again gets
 * the same token response back. Covers a client that lost the response (a
 * dropped connection, a 10 second timeout) and retries. Later reuse is replay.
 */
export const MCP_REFRESH_TOKEN_REUSE_SECONDS = 30

/** Prefixes make opaque tokens recognisable to secret scanners and to routing. */
export const MCP_ACCESS_TOKEN_PREFIX = 'areca_at_'
export const MCP_REFRESH_TOKEN_PREFIX = 'areca_rt_'

const DAY_MS = 24 * 60 * 60 * 1000
/** A connection unused for this long stops working (see connections.ts). */
export const MCP_CONNECTION_IDLE_MS = 90 * DAY_MS

const RESOURCE_PATH_PREFIX = '/api/mcp/'
/** The agency connector's path (docs/design/agency-mcp.md). Never a site slug. */
export const AGENCY_MCP_RESOURCE_PATH = '/api/agency/mcp'

function appBaseUrl(): string {
  return env.APP_URL.replace(/\/+$/, '')
}

/**
 * The protected resource for one site: its connector URL and the RFC 8707
 * `resource` value clients send. Both the PRM document and the Connect AI page
 * use this exact string, so they cannot drift apart.
 */
export function mcpResourceUrl(siteSlug: string): string {
  return `${appBaseUrl()}${RESOURCE_PATH_PREFIX}${siteSlug}`
}

/**
 * The site slug a resource identifier names, or null when it is not one of
 * this deployment's MCP resources. Exact string match, so a different origin,
 * a trailing slash or a query string never matches.
 */
export function siteSlugFromMcpResource(resource: string): string | null {
  const prefix = `${appBaseUrl()}${RESOURCE_PATH_PREFIX}`
  if (!resource.startsWith(prefix)) return null
  const slug = resource.slice(prefix.length)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null
  return mcpResourceUrl(slug) === resource ? slug : null
}

/** The protected resource of the agency connector: every site, one address. */
export function agencyMcpResourceUrl(): string {
  return `${appBaseUrl()}${AGENCY_MCP_RESOURCE_PATH}`
}

/** What an MCP resource identifier names. Exact string matches only. */
export type McpResourceTarget =
  { kind: 'site'; slug: string } | { kind: 'agency' }

export function mcpResourceTarget(resource: string): McpResourceTarget | null {
  if (resource === agencyMcpResourceUrl()) return { kind: 'agency' }
  const slug = siteSlugFromMcpResource(resource)
  return slug === null ? null : { kind: 'site', slug }
}

async function registerResource(identifier: string, name: string) {
  const now = new Date()
  await db
    .insert(oauthResource)
    .values({ identifier, name, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: oauthResource.identifier })
}

/**
 * Makes sure the authorization server knows an MCP resource for an existing
 * site. The plugin rejects unknown resources, and sites come and go, so the
 * row is created on first use (the authorize request) instead of at boot.
 * Returns the site slug when the resource is valid, or null otherwise.
 */
export async function ensureMcpSiteResource(
  resource: string,
): Promise<string | null> {
  const slug = siteSlugFromMcpResource(resource)
  if (!slug) return null
  const [found] = await db
    .select({ name: site.name })
    .from(site)
    .where(eq(site.slug, slug))
    .limit(1)
  if (!found) return null

  await registerResource(resource, `${found.name} (Areca CMS)`)
  return slug
}

/**
 * Makes sure the authorization server knows an MCP resource, for either kind.
 * Returns what the resource names, or null when it is not one of this
 * deployment's resources (or names a site that does not exist).
 */
export async function ensureMcpResource(
  resource: string,
): Promise<McpResourceTarget | null> {
  const target = mcpResourceTarget(resource)
  if (!target) return null
  if (target.kind === 'agency') {
    await registerResource(resource, 'Areca agency')
    return target
  }
  return (await ensureMcpSiteResource(resource)) === null ? null : target
}

/** Every `resource` value from a raw or parsed query, in order. */
export function resourceParams(query: string | string[] | undefined | null) {
  if (query === undefined || query === null) return []
  return (Array.isArray(query) ? query : [query]).filter(
    (value) => value.length > 0,
  )
}

/**
 * The site id an authorization request is for, from its first MCP resource.
 * Used as the consent `referenceId`, which makes consent (and therefore the
 * connection and its tokens) per site instead of per app.
 */
export async function siteIdForAuthorizationQuery(
  query: string | undefined,
): Promise<string | undefined> {
  if (!query) return undefined
  for (const resource of new URLSearchParams(query).getAll('resource')) {
    const slug = siteSlugFromMcpResource(resource)
    if (!slug) continue
    const [found] = await db
      .select({ id: site.id })
      .from(site)
      .where(eq(site.slug, slug))
      .limit(1)
    if (found) return found.id
  }
  return undefined
}
