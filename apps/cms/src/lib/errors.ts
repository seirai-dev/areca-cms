import { stripSecurityCode } from '#/lib/security-errors'
import { m } from '#/paraglide/messages'

/** The `message` of an Error or of a plain error-shaped object (server fns can surface either). */
function messageOf(error: unknown): string | null {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : undefined
  return typeof message === 'string' && message ? message : null
}

/**
 * Text for a toast or an inline error: the error's message without a security
 * code prefix (`MFA_REQUIRED: …`), or `fallback` when it has none.
 */
export function errorMessage(
  error: unknown,
  fallback: string = m.admin_error_generic(),
) {
  const message = messageOf(error)
  return (message && stripSecurityCode(message)) || fallback
}

/**
 * Messages written for developers: React Query's own text (for example
 * `data is undefined` when a query returns nothing) and JS runtime errors.
 */
const INTERNAL_ERROR =
  /data is undefined|cannot be undefined|Affected query key|^\[|is not a function|Cannot read propert/i

/** The message when it is safe to show under a failed query, otherwise null. */
export function errorDetail(error: unknown): string | null {
  const message = messageOf(error)
  if (!message) return null
  if (error instanceof TypeError || INTERNAL_ERROR.test(message)) return null
  return stripSecurityCode(message) || null
}
