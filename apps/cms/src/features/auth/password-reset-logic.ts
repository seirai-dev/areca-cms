/** The minimum for a new password: the same rule setup and invitations use. */
export const PASSWORD_MIN_LENGTH = 8

/** The part of a Better Auth client error these checks read. */
type AuthFailure = { code?: string; status?: number } | null | undefined

/** Asking for a link too often: the server says so, and the form shows its message. */
export function passwordResetRateLimited(failure: AuthFailure) {
  return (
    failure?.code === 'PASSWORD_RESET_RATE_LIMITED' || failure?.status === 429
  )
}

/** The token is unknown, expired or already used. */
export function resetTokenInvalid(failure: AuthFailure) {
  return failure?.code === 'INVALID_TOKEN'
}

/** The confirmation must be typed exactly as the new password. */
export function passwordsMatch(password: string, confirmation: string) {
  return password === confirmation
}
