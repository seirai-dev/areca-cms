import { APIError } from 'better-auth/api'

import { REAUTH_REQUIRED } from '#/lib/security-errors'
import { isFresh } from '#/lib/step-up'
import { m } from '#/paraglide/messages'

/**
 * Endpoints that enable, disable, re-issue or reveal a user's second factor.
 * `get-totp-uri` returns the TOTP secret, so it gets the same local MFA and
 * freshness checks as the endpoints that change the factor.
 */
export const TWO_FACTOR_MANAGEMENT_PATHS = new Set([
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/two-factor/get-totp-uri',
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

/**
 * The TOTP secret is only needed to set up an authenticator. Once two-factor is
 * on, the secret is no longer handed out, so the URI cannot be read again.
 */
export function assertTotpUriAvailable(twoFactorEnabled: boolean) {
  if (!twoFactorEnabled) return
  throw new APIError('FORBIDDEN', {
    code: 'TOTP_URI_UNAVAILABLE',
    message: m.server_totp_uri_unavailable(),
  })
}
