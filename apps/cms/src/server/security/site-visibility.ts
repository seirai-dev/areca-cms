import { eq } from 'drizzle-orm'

import { auditLog } from '#/db/schema'
import { isDevSite } from '#/lib/site-environment'
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
export { isDevSite }

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
 * Audit rows a non-admin may read: every row not flagged `agency_only`. The
 * flag is set when the row is written (see `audit()`), so the filter needs no
 * join and keeps working after a dev env and its `site_id` are deleted.
 */
export function clientVisibleAuditFilter() {
  return eq(auditLog.agencyOnly, false)
}
