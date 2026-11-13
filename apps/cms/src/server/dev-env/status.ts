import { and, desc, eq, or } from 'drizzle-orm'

import { db } from '#/db'
import type { DbReader } from '#/db'
import { environmentPush, publication, site, user } from '#/db/schema'

/** Most recent fork, reset, push and copy rows shown on the production site. */
export const DEV_ENV_HISTORY_LIMIT = 20

/**
 * The production site's development environment, or null when it has none.
 * `history` lists its recent fork, reset, push and copy rows (newest first).
 */
export async function getDevEnvironmentStatus(productionSiteId: string) {
  const dev = (
    await db
      .select({
        id: site.id,
        slug: site.slug,
        name: site.name,
        lastForkedAt: site.lastForkedAt,
        lastPushedAt: site.lastPushedAt,
        createdAt: site.createdAt,
      })
      .from(site)
      .where(eq(site.parentSiteId, productionSiteId))
      .limit(1)
  ).at(0)
  if (!dev) return null

  const history = await db
    .select({
      id: environmentPush.id,
      kind: environmentPush.kind,
      counts: environmentPush.counts,
      createdAt: environmentPush.createdAt,
      actorName: user.name,
    })
    .from(environmentPush)
    .leftJoin(user, eq(user.id, environmentPush.actorId))
    .where(eq(environmentPush.productionSiteId, productionSiteId))
    .orderBy(desc(environmentPush.createdAt), desc(environmentPush.id))
    .limit(DEV_ENV_HISTORY_LIMIT)

  return { ...dev, history }
}

/**
 * Whether a site has ever gone live: a release was live for it. A development
 * environment can be created once the site is in Production mode or has gone
 * live (docs/design/dev-environments.md, Decision 5), and a site that has gone
 * live cannot switch back to Demo mode.
 */
export async function hasGoneLive(
  siteId: string,
  reader: DbReader = db,
): Promise<boolean> {
  const rows = await reader
    .select({ id: publication.id })
    .from(publication)
    .where(
      and(
        eq(publication.siteId, siteId),
        or(eq(publication.wasLive, true), eq(publication.status, 'live')),
      ),
    )
    .limit(1)
  return rows.length > 0
}
