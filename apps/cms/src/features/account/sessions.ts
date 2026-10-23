/**
 * Better Auth answers `listSessions` with SESSION_NOT_FRESH when the signed-in
 * session is older than its fresh age. The list then needs a new sign-in.
 */
export const SESSION_NOT_FRESH = 'SESSION_NOT_FRESH'

export function isSessionNotFresh(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === SESSION_NOT_FRESH
  )
}

/** The current session first, then the rest, most recently active first. */
export function orderSessions<
  T extends { token: string; updatedAt: string | Date },
>(sessions: readonly T[], currentToken: string | null | undefined): T[] {
  return [...sessions].sort((a, b) => {
    if (a.token === currentToken) return -1
    if (b.token === currentToken) return 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}
