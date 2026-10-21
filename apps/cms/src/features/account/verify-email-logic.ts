import type { Me } from '#/server/fn/me'

/** "Not now" is remembered per browser and per account, so a new account is prompted again. */
export function verifyEmailDismissedKey(userId: string) {
  return `areca:verify-email-dismissed:${userId}`
}

/**
 * The reminder is for signed-in people who have not confirmed their address.
 * It waits while a two-factor step is pending, since that page comes first.
 */
export function needsEmailVerification(me: Me) {
  return (
    !me.user.emailVerified &&
    !me.mfaEnrolmentRequired &&
    !me.mfaVerificationRequired
  )
}

/** The verification link returns to `/?verified=1`. */
export function isVerifiedRedirect(searchString: string) {
  return new URLSearchParams(searchString).get('verified') === '1'
}

/** The search object without `verified`, so a refresh does not repeat the toast. */
export function withoutVerifiedParam<T extends Record<string, unknown>>(
  search: T,
): Omit<T, 'verified'> {
  const { verified: _verified, ...rest } = search
  return rest
}
