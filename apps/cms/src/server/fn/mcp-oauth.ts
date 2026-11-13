/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from '#/lib/zod'

import { db } from '#/db'
import { mcpConnection } from '#/db/schema'
import { ID_MAX_LENGTH } from '#/lib/content-limits'
import {
  requireAgencyAdmin,
  requireSignedIn,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import {
  approveAgencyConsentRequest,
  approveConsentRequest,
  denyConsentRequest,
  describeConsentRequest,
} from '#/server/mcp/consent'
import {
  listAgencyConnections,
  listConnections,
  revokeAgencyConnection,
  revokeConnection,
} from '#/server/mcp/connections'
import {
  agencyMcpResourceUrl,
  mcpResourceUrl,
} from '#/server/mcp/oauth-resource'
import { requireMcpSiteAccess } from '#/server/mcp/site-access'

/**
 * Server functions for the OAuth consent screen and the Connect AI page's
 * "connected apps" list. Business rules live in server/mcp/consent.ts and
 * server/mcp/connections.ts; these wrappers only validate input.
 */

const loose = { strict: { output: false } as const }

const queryField = z.string().min(1).max(4_000)

export const getOAuthConsentFn = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ query: queryField }))
  .handler(async ({ data }) => describeConsentRequest(data.query))

export const approveOAuthConsentFn = createServerFn({
  method: 'POST',
  ...loose,
})
  .validator(
    z.object({
      query: queryField,
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      allowGoLive: z.boolean(),
    }),
  )
  .handler(async ({ data }) =>
    approveConsentRequest({
      query: data.query,
      siteId: data.siteId,
      allowGoLive: data.allowGoLive,
    }),
  )

/**
 * Approves the agency connector for an app (every client and site). Agency
 * admins only, with a fresh second factor; the server checks both.
 */
export const approveAgencyOAuthConsentFn = createServerFn({
  method: 'POST',
  ...loose,
})
  .validator(z.object({ query: queryField }))
  .handler(async ({ data }) =>
    approveAgencyConsentRequest({ query: data.query }),
  )

export const denyOAuthConsentFn = createServerFn({ method: 'POST', ...loose })
  .validator(z.object({ query: queryField }))
  .handler(async ({ data }) => {
    await requireSignedIn()
    return denyConsentRequest(data.query)
  })

/** Apps connected to a site: owners and agency admins see all, editors their own. */
export const listMcpConnectionsFn = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ siteId: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const {
      session,
      site: found,
      role,
    } = await requireMcpSiteAccess(data.siteId)
    const connections = await listConnections({
      siteId: found.id,
      userId: session.user.id,
      includeAllUsers: role !== 'editor',
    })
    return {
      connections: connections.map((row) => ({
        id: row.id,
        clientName: row.clientName,
        userId: row.userId,
        userName: row.userName,
        allowGoLive: row.allowGoLive,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
      })),
      connectorUrl: mcpResourceUrl(found.slug),
    }
  })

/** Disconnects an app from a site. Takes effect on its next request. */
export const revokeMcpConnectionFn = createServerFn({
  method: 'POST',
  ...loose,
})
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    await requireUser()
    const [connection] = await db
      .select({ siteId: mcpConnection.siteId })
      .from(mcpConnection)
      .where(eq(mcpConnection.id, data.id))
      .limit(1)
    // Agency connections have no site; they are revoked from the Agency page.
    if (!connection?.siteId)
      throw new NotFoundError(m.server_mcp_connection_not_found())

    const {
      session,
      site: found,
      role,
    } = await requireMcpSiteAccess(connection.siteId)
    await revokeConnection({
      id: data.id,
      siteId: found.id,
      actorId: session.user.id,
      organizationId: found.organizationId,
      canRevokeOthers: role !== 'editor',
    })
    return { ok: true as const }
  })

/** Apps connected to the agency connector: the caller's own, agency admins only. */
export const listAgencyMcpConnectionsFn = createServerFn({
  method: 'GET',
  ...loose,
}).handler(async () => {
  const session = await requireAgencyAdmin()
  const connections = await listAgencyConnections({
    userId: session.user.id,
  })
  return {
    connections: connections.map((row) => ({
      id: row.id,
      clientName: row.clientName,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    })),
    connectorUrl: agencyMcpResourceUrl(),
  }
})

/** Disconnects one of the caller's agency apps. Takes effect on its next request. */
export const revokeAgencyMcpConnectionFn = createServerFn({
  method: 'POST',
  ...loose,
})
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await revokeAgencyConnection({ id: data.id, actorId: session.user.id })
    return { ok: true as const }
  })
