import { APIError } from 'better-auth/api'

import { REAUTH_REQUIRED } from '#/lib/security-errors'
import { isFresh } from '#/lib/step-up'

/** Endpoints that enable, disable or re-issue a user's second factor. */
export const TWO_FACTOR_MANAGEMENT_PATHS = new Set([
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
])

/**
 * With `allowPasswordless`, Better Auth skips the password check for users
 * who have no credential password (SSO/social only). Those users must have
 * signed in within the step-up window instead; users with a password keep
 * the normal password confirmation.
 */
export function assertPasswordlessFresh(
  input: { hasPassword: boolean; sessionCreatedAt: Date },
  now: Date = new Date(),
) {
  if (input.hasPassword) return
  if (isFresh([input.sessionCreatedAt], now)) return
  throw new APIError('FORBIDDEN', {
    code: REAUTH_REQUIRED,
    message: `${REAUTH_REQUIRED}: Sign in again to change two-factor authentication.`,
  })
}
