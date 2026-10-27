/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from '#/lib/zod'

import { db } from '#/db'
import { mcpKey } from '#/db/schema'
import { env } from '#/env'
import { ID_MAX_LENGTH } from '#/lib/content-limits'
import { requireAgencyAdmin, requireUser } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import type { MCP_KEY_EXPIRY_OPTIONS, McpKeySummary } from '#/server/mcp/keys'
import {
  createAgencyMcpKey,
  createMcpKey,
  listAgencyMcpKeys,
  listMcpKeys,
  revokeAgencyMcpKey,
  revokeMcpKey,
} from '#/server/mcp/keys'
import { requireMcpSiteAccess } from '#/server/mcp/site-access'
import { assertFreshSession } from '#/server/security/step-up'

const loose = { strict: { output: false } as const }

const expirySchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(365),
  z.null(),
]) satisfies z.ZodType<(typeof MCP_KEY_EXPIRY_OPTIONS)[number]>

/** Public URL of the personal-key MCP endpoint, as shown in install snippets. */
function mcpEndpointUrl() {
  return `${env.APP_URL.replace(/\/+$/, '')}/api/mcp`
}

/** Public URL of the agency connector (every site, one address). */
function agencyMcpEndpointUrl() {
  return `${env.APP_URL.replace(/\/+$/, '')}/api/agency/mcp`
}

export const listMcpKeysFn = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ siteId: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const {
      session,
      site: found,
      role,
    } = await requireMcpSiteAccess(data.siteId)
    const keys: McpKeySummary[] = await listMcpKeys({
      siteId: found.id,
      userId: session.user.id,
      includeAllUsers: role !== 'editor',
    })
    return {
      keys,
      endpointUrl: mcpEndpointUrl(),
      siteSlug: found.slug,
      siteName: found.name,
      role,
      canAllowGoLive: role !== 'editor',
    }
  })

export const createMcpKeyFn = createServerFn({ method: 'POST', ...loose })
  .validator(
    z.object({
      siteId: z.string().min(1).max(ID_MAX_LENGTH),
      name: z.string().max(200),
      expiresInDays: expirySchema,
      allowGoLive: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const {
      session,
      site: found,
      role,
    } = await requireMcpSiteAccess(data.siteId)
    // Creating a key as an agency admin is a privileged act: the key acts with
    // admin power for as long as it lives, so re-verify the second factor.
    if (role === 'agency') await assertFreshSession(session)

    const created = await createMcpKey({
      userId: session.user.id,
      siteId: found.id,
      organizationId: found.organizationId,
      name: data.name,
      expiresInDays: data.expiresInDays,
      allowGoLive: data.allowGoLive,
      role,
    })
    return {
      key: created.key,
      token: created.token,
      endpointUrl: mcpEndpointUrl(),
    }
  })

export const revokeMcpKeyFn = createServerFn({ method: 'POST', ...loose })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    await requireUser()
    const [key] = await db
      .select({ siteId: mcpKey.siteId })
      .from(mcpKey)
      .where(eq(mcpKey.id, data.id))
      .limit(1)
    // Agency keys have no site; they are revoked from the Agency page.
    if (!key?.siteId) throw new NotFoundError(m.server_mcp_key_not_found())

    const {
      session,
      site: found,
      role,
    } = await requireMcpSiteAccess(key.siteId)
    await revokeMcpKey({
      id: data.id,
      siteId: found.id,
      actorId: session.user.id,
      organizationId: found.organizationId,
      canRevokeOthers: role !== 'editor',
    })
    return { ok: true as const }
  })

/**
 * Agency keys: one key for every site, for agency admins only. Creating one
 * is a privileged act, so it needs a fresh second factor (agency-mcp Decision 11).
 * The keys list is the caller's own; there is no site.
 */
export const listAgencyMcpKeysFn = createServerFn({
  method: 'GET',
  ...loose,
}).handler(async () => {
  const session = await requireAgencyAdmin()
  const keys: McpKeySummary[] = await listAgencyMcpKeys({
    userId: session.user.id,
  })
  return { keys, endpointUrl: agencyMcpEndpointUrl() }
})

export const createAgencyMcpKeyFn = createServerFn({ method: 'POST', ...loose })
  .validator(
    z.object({
      name: z.string().max(200),
      expiresInDays: expirySchema,
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await assertFreshSession(session)
    const created = await createAgencyMcpKey({
      userId: session.user.id,
      name: data.name,
      expiresInDays: data.expiresInDays,
    })
    return {
      key: created.key,
      token: created.token,
      endpointUrl: agencyMcpEndpointUrl(),
    }
  })

export const revokeAgencyMcpKeyFn = createServerFn({ method: 'POST', ...loose })
  .validator(z.object({ id: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const session = await requireAgencyAdmin()
    await revokeAgencyMcpKey({ id: data.id, userId: session.user.id })
    return { ok: true as const }
  })
