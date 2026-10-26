import { and, isNull, ne, notLike, or } from 'drizzle-orm'

import { auditLog, site as siteTable } from '#/db/schema'
import { assertAdminMfa } from '#/lib/session.server'
import { MfaRequiredError } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'
import { NotFoundError } from '#/server/content/errors'

import { requireAdminLocalMfa } from './local-mfa'

/**
 * Development environments (docs/design/dev-environments.md, Decision 3) are
 * visible to agency admins only. Every site-scoped check goes through this
 * module, so the rule lives in one place.
 */
export function isDevSite(site: { environment: string }): boolean {
  return site.environment === 'development'
}

type VisibilityPrincipal = {
  session: { id: string }
  user: {
    id: string
    isAgencyAdmin?: boolean
    twoFactorEnabled?: boolean | null
  }
}

/**
 * The `requireAgencyAdmin` bar without the redirect or the 403: an agency
 * admin with two-factor enabled and a local factor proof in this session.
 */
export async function isAgencyAdminWithMfa(
  principal: VisibilityPrincipal,
): Promise<boolean> {
  if (!principal.user.isAgencyAdmin) return false
  try {
    assertAdminMfa(principal.user)
    await requireAdminLocalMfa(principal)
    return true
  } catch (error) {
    if (error instanceof MfaRequiredError) return false
    throw error
  }
}

/**
 * Throws NotFound for a development environment unless the caller is an
 * agency admin with MFA satisfied. Other sites pass through unchanged.
 * `notFound` lets callers with their own error type (Response, HTTP
 * handlers) reuse the same rule.
 */
export async function assertSiteVisibleTo(
  principal: VisibilityPrincipal,
  site: { environment: string },
  notFound: () => Error = () => new NotFoundError(m.server_site_not_found()),
): Promise<void> {
  if (!isDevSite(site)) return
  if (await isAgencyAdminWithMfa(principal)) return
  throw notFound()
}

/**
 * Audit rows a non-admin may read. The query must left-join `site` on
 * `audit_log.site_id`. Rows of a dev env and the `dev_env.*` actions (fork,
 * refresh, push, copy, delete) are agency-only (Decision 22).
 */
export function clientVisibleAuditFilter() {
  return and(
    or(isNull(siteTable.id), ne(siteTable.environment, 'development')),
    notLike(auditLog.action, 'dev_env.%'),
  )
}
