/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .returning()/.select() are checked defensively */
import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '#/db'
import { membership, mcpKey, site } from '#/db/schema'
import { env } from '#/env'
import { ID_MAX_LENGTH } from '#/lib/content-limits'
import {
  requireOrgMemberOrNotFound,
  requireUser,
} from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import type { MCP_KEY_EXPIRY_OPTIONS, McpKeySummary, McpRole } from '#/server/mcp/keys'
import { createMcpKey, listMcpKeys, revokeMcpKey } from '#/server/mcp/keys'
import { assertFreshSession } from '#/server/security/step-up'

const loose = { strict: { output: false } as const }

const expirySchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(365),
  z.null(),
]) satisfies z.ZodType<(typeof MCP_KEY_EXPIRY_OPTIONS)[number]>

/** Public URL of the per-site MCP endpoint, as shown in install snippets. */
function mcpEndpointUrl() {
  return `${env.APP_URL.replace(/\/+$/, '')}/api/mcp`
}

/**
 * Site access for the Connect AI page. Answers NotFound both for a missing
 * site and for one the caller cannot reach, like the content functions do.
 */
async function requireMcpSiteAccess(siteId: string) {
  await requireUser()
  const [found] = await db
    .select()
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1)
  if (!found) throw new NotFoundError(m.server_site_not_found())
  const session = await requireOrgMemberOrNotFound(
    found.organizationId,
    undefined,
    () => new NotFoundError(m.server_site_not_found()),
  )
  const role = await roleFor(session, found.organizationId)
  return { session, site: found, role }
}

/** Agency admins act as 'agency'; everyone else as their membership role. */
async function roleFor(
  session: { user: { id: string; isAgencyAdmin: boolean } },
  organizationId: string,
): Promise<McpRole> {
  if (session.user.isAgencyAdmin) return 'agency'
  const [member] = await db
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.userId, session.user.id),
        eq(membership.organizationId, organizationId),
      ),
    )
    .limit(1)
  if (!member) throw new NotFoundError(m.server_site_not_found())
  return member.role
}

export const listMcpKeysFn = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ siteId: z.string().min(1).max(ID_MAX_LENGTH) }))
  .handler(async ({ data }) => {
    const { session, site: found, role } = await requireMcpSiteAccess(
      data.siteId,
    )
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
    const { session, site: found, role } = await requireMcpSiteAccess(
      data.siteId,
    )
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
    if (!key) throw new NotFoundError(m.server_mcp_key_not_found())

    const { session, site: found, role } = await requireMcpSiteAccess(
      key.siteId,
    )
    await revokeMcpKey({
      id: data.id,
      siteId: found.id,
      actorId: session.user.id,
      organizationId: found.organizationId,
      canRevokeOthers: role !== 'editor',
    })
    return { ok: true as const }
  })
