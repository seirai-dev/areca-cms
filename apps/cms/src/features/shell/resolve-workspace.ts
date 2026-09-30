import type { Me } from '#/server/fn/me'

export type WorkspaceTarget =
  { kind: 'site'; siteId: string } | { kind: 'agency' } | { kind: 'picker' }

/**
 * Where `/` sends you (brief §2), pure so it can be tested:
 * 1. the last-used site, when you can still open it;
 * 2. your only site;
 * 3. the Agency workspace for agency admins;
 * 4. the `/sites` picker (zero or several sites).
 */
export function resolveWorkspace(
  me: Pick<Me, 'sites' | 'user'>,
  lastSiteId: string | null | undefined,
): WorkspaceTarget {
  if (lastSiteId && me.sites.some((site) => site.id === lastSiteId)) {
    return { kind: 'site', siteId: lastSiteId }
  }
  if (me.sites.length === 1) {
    return { kind: 'site', siteId: me.sites[0].id }
  }
  if (me.user.isAgencyAdmin) return { kind: 'agency' }
  return { kind: 'picker' }
}
