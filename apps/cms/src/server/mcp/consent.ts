import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { db } from '#/db'
import { membership, oauthClient, site } from '#/db/schema'
import { env } from '#/env'
import { auth } from '#/lib/auth'
import {
  getSession,
  requireAgencyAdmin,
  requireSignedIn,
} from '#/lib/session.server'
import { ReauthRequiredError } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'
import { ForbiddenError, ValidationError } from '#/server/content/errors'
import { localMfaVerifiedAt } from '#/server/security/local-mfa'
import { assertFreshSession } from '#/server/security/step-up'
import {
  isAgencyAdminWithMfa,
  isDevSite,
} from '#/server/security/site-visibility'

import {
  findUsableAgencyConnection,
  findUsableConnection,
  saveConnectionApproval,
  withConnectionLock,
} from './connections'
import { withApprovalReference } from './oauth-grants'
import { agencyAdminStatus, liveRoleFor } from './keys'
import type { McpRole } from './keys'
import { mcpResourceTarget } from './oauth-resource'
import type { McpResourceTarget } from './oauth-resource'
import { requireMcpSiteAccess } from './site-access'
import { siteCoreColumns } from '#/server/content/site-core'

/**
 * The consent screen's view of a signed authorization request (the `oauth_query`
 * the plugin appends when it sends the user to /oauth/consent).
 */
export type ConsentQuery = {
  clientId: string
  redirectUri: string
  /** The one MCP resource the request names: a site, or the agency connector. */
  target: McpResourceTarget
}

/**
 * Checks the signature and expiry of a consent query and reads its fields.
 * Null when the query was tampered with, expired, or not an authorization
 * request. Nothing from the query is trusted before this passes.
 */
export async function readSignedConsentQuery(
  query: string,
): Promise<ConsentQuery | null> {
  if (!(await verifyOAuthQueryParams(query, env.BETTER_AUTH_SECRET))) {
    return null
  }
  const params = new URLSearchParams(query)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  if (!clientId || !redirectUri) return null

  const resources = params.getAll('resource')
  if (resources.length !== 1) return null
  const target = mcpResourceTarget(resources[0] ?? '')
  if (!target) return null
  return { clientId, redirectUri, target }
}

/** The registered app behind a client id, or null. */
export async function findOAuthClient(clientId: string) {
  const client = (
    await db
      .select()
      .from(oauthClient)
      .where(
        and(
          eq(oauthClient.clientId, clientId),
          eq(oauthClient.disabled, false),
        ),
      )
      .limit(1)
  ).at(0)
  return client ?? null
}

/** Only http(s) logos are shown; anything else falls back to a placeholder. */
export function safeLogoUri(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null
  } catch {
    return null
  }
}

/** The host of a redirect URI, shown on consent so users can spot a spoofed app. */
export function redirectHostOf(redirectUri: string): string {
  try {
    return new URL(redirectUri).host
  } catch {
    return redirectUri
  }
}

/**
 * Sites the user can connect an app to: their organizations' sites, or every
 * site for an agency admin.
 */
export async function listConnectableSites(input: {
  userId: string
  isAgencyAdmin: boolean
}) {
  if (input.isAgencyAdmin) {
    return db
      .select({ id: site.id, name: site.name, slug: site.slug })
      .from(site)
      .orderBy(asc(site.name))
      .limit(500)
  }
  const orgIds = await db
    .select({ organizationId: membership.organizationId })
    .from(membership)
    .where(eq(membership.userId, input.userId))
  if (orgIds.length === 0) return []
  return db
    .select({ id: site.id, name: site.name, slug: site.slug })
    .from(site)
    .where(
      and(
        inArray(
          site.organizationId,
          orgIds.map((row) => row.organizationId),
        ),
        eq(site.environment, 'production'),
      ),
    )
    .orderBy(asc(site.name))
    .limit(500)
}

/**
 * Completes the plugin's consent step for a signed query, through the same
 * HTTP handler the browser would call, with the user's session cookies. (The
 * endpoint needs a real request to resume authorization, so calling it as a
 * bare API method does not work.) Returns where to send the user: the app's
 * redirect URI with a code, or with `access_denied`.
 */
export async function completePluginConsent(input: {
  query: string
  accept: boolean
}): Promise<string> {
  const incoming = getRequestHeaders()
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json',
    origin: new URL(env.BETTER_AUTH_URL).origin,
  })
  const cookie = incoming.get('cookie')
  if (cookie) headers.set('cookie', cookie)

  const response = await auth.handler(
    new Request(new URL('/api/auth/oauth2/consent', env.BETTER_AUTH_URL), {
      method: 'POST',
      headers,
      body: JSON.stringify({ accept: input.accept, oauth_query: input.query }),
    }),
  )
  const body = (await response.json()) as {
    url?: unknown
    redirect_uri?: unknown
  }
  if (!response.ok) {
    throw new ValidationError([
      { path: 'query', message: m.server_mcp_oauth_link_invalid() },
    ])
  }
  if (typeof body.url === 'string') return body.url
  if (typeof body.redirect_uri === 'string') return body.redirect_uri
  throw new Error('Consent did not return a redirect')
}

export type ConsentSite = { id: string; name: string; slug: string }

/** The app as the consent screen shows it. */
export type ConsentClient = {
  id: string
  name: string
  redirectHost: string
  logoUri: string | null
}

export type ConsentInfo =
  | {
      ok: true
      kind: 'site'
      client: ConsentClient
      site: ConsentSite
      sites: ConsentSite[]
      role: McpRole
      canAllowGoLive: boolean
      needsStepUp: boolean
    }
  | {
      ok: true
      kind: 'agency'
      client: ConsentClient
      /** The plain-language warning shown before the agency approval. Resolved for the request's locale. */
      warning: { title: string; body: string }
      needsStepUp: boolean
    }
  | {
      ok: false
      reason: 'signed_out' | 'invalid_request' | 'unknown_site' | 'no_access'
      message: string
    }

/**
 * What the consent screen shows for a signed request: the app, what it asks
 * for (one site, or every site for the agency connector) and the signed-in
 * user's role there. Changes nothing.
 */
export async function describeConsentRequest(
  query: string,
): Promise<ConsentInfo> {
  const parsed = await readSignedConsentQuery(query)
  if (!parsed) {
    return {
      ok: false,
      reason: 'invalid_request',
      message: m.server_mcp_oauth_link_invalid(),
    }
  }
  const session = await getSession()
  if (!session) {
    return {
      ok: false,
      reason: 'signed_out',
      message: m.server_mcp_oauth_signed_out(),
    }
  }
  const registered = await findOAuthClient(parsed.clientId)
  if (!registered) {
    return {
      ok: false,
      reason: 'invalid_request',
      message: m.server_mcp_oauth_app_unknown(),
    }
  }
  const client: ConsentClient = {
    id: registered.clientId,
    name: registered.name?.trim() || m.server_mcp_oauth_unnamed_app(),
    redirectHost: redirectHostOf(parsed.redirectUri),
    logoUri: safeLogoUri(registered.icon),
  }
  if (parsed.target.kind === 'agency') {
    return describeAgencyConsent(session, client)
  }
  const siteSlug = parsed.target.slug

  const target = (
    await db
      .select(siteCoreColumns)
      .from(site)
      .where(eq(site.slug, siteSlug))
      .limit(1)
  ).at(0)
  // A dev env is not offered to anyone but an agency admin (Decision 3).
  if (
    !target ||
    (isDevSite(target) && !(await isAgencyAdminWithMfa(session)))
  ) {
    return {
      ok: false,
      reason: 'unknown_site',
      message: m.server_mcp_oauth_site_unknown(),
    }
  }
  const live = await liveRoleFor(session.user, target.organizationId)
  if (!live.ok) {
    return {
      ok: false,
      reason: 'no_access',
      message:
        live.reason === 'mfa_required'
          ? m.server_mcp_oauth_mfa_required()
          : m.server_mcp_oauth_no_access(),
    }
  }

  const role = live.role
  return {
    ok: true,
    kind: 'site',
    client,
    site: { id: target.id, name: target.name, slug: target.slug },
    sites: await listConnectableSites({
      userId: session.user.id,
      isAgencyAdmin: session.user.isAgencyAdmin,
    }),
    role,
    canAllowGoLive: role !== 'editor',
    needsStepUp:
      role === 'agency'
        ? await needsReauth(session)
        : await needsMemberCode(session),
  }
}

/**
 * The agency variant: only an agency admin with two-factor auth may approve
 * it. The warning says what the app gets; there is no go-live choice.
 */
async function describeAgencyConsent(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  client: ConsentClient,
): Promise<ConsentInfo> {
  const status = agencyAdminStatus(session.user)
  if (status !== 'active' || !(await isAgencyAdminWithMfa(session))) {
    return {
      ok: false,
      reason: 'no_access',
      message:
        status === 'mfa_required'
          ? m.server_mcp_oauth_mfa_required()
          : m.server_mcp_oauth_agency_no_access(),
    }
  }
  return {
    ok: true,
    kind: 'agency',
    client,
    warning: {
      title: m.server_mcp_oauth_agency_title({ app: client.name }),
      body: m.server_mcp_oauth_agency_body(),
    },
    needsStepUp: await needsReauth(session),
  }
}

/**
 * Allows an app to act on a site as the signed-in user. Access is checked
 * first (so a non-member learns nothing about the request), then the query is
 * verified, the connection recorded, and the plugin's consent completed.
 * Returns where to send the user.
 */
export async function approveConsentRequest(input: {
  query: string
  siteId: string
  allowGoLive: boolean
}): Promise<{ redirectTo: string }> {
  // After a provider sign-in, a two-factor user has not entered a code yet.
  // The consent screen's code dialog answers REAUTH_REQUIRED and retries.
  if (await needsMemberCode(await requireSignedIn())) {
    throw new ReauthRequiredError()
  }
  const {
    session,
    site: found,
    role,
  } = await requireMcpSiteAccess(input.siteId)
  // An agency admin's approval grants the app admin power, so it needs a
  // fresh second factor, like creating a personal key.
  if (role === 'agency') await assertFreshSession(session)
  if (input.allowGoLive && role === 'editor') {
    throw new ForbiddenError(m.server_mcp_key_go_live_owners_only())
  }

  const parsed = await readSignedConsentQuery(input.query)
  if (!parsed) {
    throw new ValidationError([
      { path: 'query', message: m.server_mcp_oauth_link_invalid() },
    ])
  }
  if (parsed.target.kind !== 'site' || parsed.target.slug !== found.slug) {
    throw new ValidationError([
      { path: 'siteId', message: m.server_mcp_oauth_site_mismatch() },
    ])
  }
  const client = await findOAuthClient(parsed.clientId)
  if (!client) {
    throw new ValidationError([
      { path: 'query', message: m.server_mcp_oauth_app_unknown() },
    ])
  }

  const identity = {
    userId: session.user.id,
    siteId: found.id,
    clientId: client.clientId,
  }
  return withConnectionLock(identity, async () => {
    const existing = await findUsableConnection(identity)
    const connectionId = existing?.id ?? crypto.randomUUID()
    // The OAuth code and tokens bind to this exact approval generation. A
    // failed plugin call must not change an existing app's go-live permission.
    const redirectTo = await withApprovalReference(connectionId, () =>
      completePluginConsent({ query: input.query, accept: true }),
    )
    const result = new URL(redirectTo)
    if (!result.searchParams.has('code')) {
      throw new ValidationError([
        { path: 'query', message: m.server_mcp_oauth_link_invalid() },
      ])
    }
    await saveConnectionApproval(
      {
        ...identity,
        organizationId: found.organizationId,
        clientName: client.name?.trim() || m.server_mcp_oauth_unnamed_app(),
        allowGoLive: input.allowGoLive && role !== 'editor',
      },
      connectionId,
    )
    return { redirectTo }
  })
}

/**
 * Allows an app to act on every client and site as the signed-in agency
 * admin (docs/design/agency-mcp.md). Checks run in this order: the caller is
 * an agency admin with two-factor auth, the session has a fresh second factor,
 * then the signed query. There is no go-live option.
 */
export async function approveAgencyConsentRequest(input: {
  query: string
}): Promise<{ redirectTo: string }> {
  const session = await requireAgencyAdmin()
  await assertFreshSession(session)

  const parsed = await readSignedConsentQuery(input.query)
  if (!parsed) {
    throw new ValidationError([
      { path: 'query', message: m.server_mcp_oauth_link_invalid() },
    ])
  }
  if (parsed.target.kind !== 'agency') {
    throw new ValidationError([
      { path: 'query', message: m.server_mcp_oauth_link_invalid() },
    ])
  }
  const client = await findOAuthClient(parsed.clientId)
  if (!client) {
    throw new ValidationError([
      { path: 'query', message: m.server_mcp_oauth_app_unknown() },
    ])
  }

  const identity = {
    userId: session.user.id,
    siteId: null,
    clientId: client.clientId,
  }
  return withConnectionLock(identity, async () => {
    const existing = await findUsableAgencyConnection({
      userId: session.user.id,
      clientId: client.clientId,
    })
    const connectionId = existing?.id ?? crypto.randomUUID()
    const redirectTo = await withApprovalReference(connectionId, () =>
      completePluginConsent({ query: input.query, accept: true }),
    )
    const result = new URL(redirectTo)
    if (!result.searchParams.has('code')) {
      throw new ValidationError([
        { path: 'query', message: m.server_mcp_oauth_link_invalid() },
      ])
    }
    await saveConnectionApproval(
      {
        ...identity,
        organizationId: null,
        clientName: client.name?.trim() || m.server_mcp_oauth_unnamed_app(),
        allowGoLive: false,
      },
      connectionId,
    )
    return { redirectTo }
  })
}

/** Refuses an app's request. The app receives `access_denied`. */
export async function denyConsentRequest(
  query: string,
): Promise<{ redirectTo: string }> {
  const parsed = await readSignedConsentQuery(query)
  if (!parsed) {
    throw new ValidationError([
      { path: 'query', message: m.server_mcp_oauth_link_invalid() },
    ])
  }
  const redirectTo = await completePluginConsent({ query, accept: false })
  return { redirectTo }
}

/** True when someone other than an agency admin still owes this session a code. */
async function needsMemberCode(session: {
  session: { id: string }
  user: { id: string; isAgencyAdmin: boolean; twoFactorEnabled: boolean }
}) {
  if (session.user.isAgencyAdmin || !session.user.twoFactorEnabled) return false
  return !(await localMfaVerifiedAt(session))
}

/** True when an agency admin's session needs a fresh second factor to approve. */
async function needsReauth(session: Parameters<typeof assertFreshSession>[0]) {
  try {
    await assertFreshSession(session)
    return false
  } catch (error) {
    if (error instanceof ReauthRequiredError) return true
    throw error
  }
}
