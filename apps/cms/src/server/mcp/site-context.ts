import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { site } from '#/db/schema'
import { isDevSite } from '#/lib/site-environment'

/**
 * Which kind of site a connector serves, and how it pairs with the other one
 * (docs/design/dev-environments.md, Decisions 20 and 21). Tools are listed by
 * environment as well as by role, and the instructions and get_site_info read it.
 */
export type McpSiteContext = {
  environment: 'production' | 'development'
  /** On a development environment: the slug of its production site. */
  productionSlug: string | null
  /**
   * On a production site: the slug of its development environment, or null.
   * Only agency admins are told about it (Decision 3).
   */
  devSlug: string | null
}

/** Reads the site's environment and its paired site with one or two lookups. */
export async function loadSiteContext(siteId: string): Promise<McpSiteContext> {
  const row = (
    await db
      .select({
        environment: site.environment,
        parentSiteId: site.parentSiteId,
      })
      .from(site)
      .where(eq(site.id, siteId))
      .limit(1)
  ).at(0)
  if (!row) {
    return { environment: 'production', productionSlug: null, devSlug: null }
  }
  if (isDevSite(row)) {
    const parent = row.parentSiteId
      ? (
          await db
            .select({ slug: site.slug })
            .from(site)
            .where(eq(site.id, row.parentSiteId))
            .limit(1)
        ).at(0)
      : undefined
    return {
      environment: 'development',
      productionSlug: parent?.slug ?? null,
      devSlug: null,
    }
  }
  const dev = (
    await db
      .select({ slug: site.slug })
      .from(site)
      .where(eq(site.parentSiteId, siteId))
      .limit(1)
  ).at(0)
  return {
    environment: 'production',
    productionSlug: null,
    devSlug: dev?.slug ?? null,
  }
}

/** Narrows the value carried in the request's authInfo to a site context. */
export function isSiteContext(value: unknown): value is McpSiteContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'environment' in value &&
    (value.environment === 'production' || value.environment === 'development')
  )
}
