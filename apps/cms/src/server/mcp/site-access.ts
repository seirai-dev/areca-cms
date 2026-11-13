import { requireSiteAccess } from '#/server/content/access'

import type { McpRole } from './keys'

/**
 * Site access for the Connect AI pages and their server functions: the
 * content guard (`requireSiteAccess`) plus the caller's role. Agency admins
 * act as 'agency'; everyone else as their membership role.
 */
export async function requireMcpSiteAccess(siteId: string) {
  const { session, site, member } = await requireSiteAccess(siteId)
  const role: McpRole = member?.role ?? 'agency'
  return { session, site, role }
}
