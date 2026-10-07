import { isNotFound, isRedirect } from '@tanstack/react-router'

import { createLogger, newErrorRef } from '#/server/log'

import { AppError } from './app-error'

export { AppError }

const log = createLogger('server-fn')

/** `code` values the UI (or a client flow) relies on. Extend as needed. */
export const PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  'MFA_REQUIRED',
  'REAUTH_REQUIRED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'RATE_LIMITED',
])

/** Error names from libraries whose messages are user-facing by contract. */
const PASSTHROUGH_NAMES: ReadonlySet<string> = new Set([
  'NotFoundError',
  'ConflictError',
  'ValidationError',
  'AssetValidationError',
  'SecurityError',
  'ZodError',
])

export function isPassthroughError(error: unknown): boolean {
  // Control-flow values must stay untouched: redirects, notFound(), Response.
  if (error instanceof Response) return true
  if (isRedirect(error) || isNotFound(error)) return true
  if (!error || typeof error !== 'object') return false
  if (error instanceof AppError) return true
  const record = error as {
    expose?: unknown
    code?: unknown
    name?: unknown
    status?: unknown
    statusCode?: unknown
  }
  if (record.expose === true) return true
  if (typeof record.code === 'string' && PASSTHROUGH_CODES.has(record.code)) {
    return true
  }
  if (typeof record.name === 'string') {
    if (PASSTHROUGH_NAMES.has(record.name)) return true
    // better-auth APIError: user-facing for 4xx only.
    if (record.name === 'APIError') {
      const status = record.statusCode
      return typeof status === 'number' && status >= 400 && status < 500
    }
  }
  return false
}

export function genericErrorMessage(ref: string) {
  return `Something went wrong (ref: ${ref})`
}

/**
 * Returns the error to surface to the client. Known errors are returned as is;
 * unknown ones are logged (redacted) with a ref and replaced.
 */
export function sanitizeServerError(
  error: unknown,
  context: Record<string, unknown> = {},
): unknown {
  if (isPassthroughError(error)) return error
  const ref = newErrorRef()
  log.error('unhandled server function error', { ref, err: error, ...context })
  return new Error(genericErrorMessage(ref))
}
