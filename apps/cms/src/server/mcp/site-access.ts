/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { and, eq } from 'drizzle-orm'

import { db } from '#/db'
import { membership, site } from '#/db/schema'
import { requireOrgMemberOrNotFound, requireUser } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'
import { assertSiteVisibleTo } from '#/server/security/site-visibility'

import type { McpRole } from './keys'

/**
 * Site access for the Connect AI pages and their server functions. Answers
 * NotFound both for a missing site and for one the caller cannot reach, like
 * the content functions do.
 */
export async function requireMcpSiteAccess(siteId: string) {
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
  await assertSiteVisibleTo(
    session,
    found,
    () => new NotFoundError(m.server_site_not_found()),
  )
  const role = await roleFor(session, found.organizationId)
  return { session, site: found, role }
}

/** Agency admins act as 'agency'; everyone else as their membership role. */
export async function roleFor(
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
