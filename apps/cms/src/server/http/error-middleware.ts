import { createMiddleware } from '@tanstack/react-start'

import { sanitizeServerError } from './safe-error'

/**
 * Global server-function middleware: typed application errors pass through,
 * everything else (database, S3, internal bugs) is logged with a reference and
 * replaced by a generic message so internals never reach the UI.
 */
export const sanitizeErrorsMiddleware = createMiddleware({
  type: 'function',
}).server(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    throw sanitizeServerError(error)
  }
})
