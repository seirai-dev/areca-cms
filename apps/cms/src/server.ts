import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

import { env } from '#/env'
import { paraglideMiddleware } from '#/paraglide/server.js'
import { enforceCmsRateLimit } from '#/server/http/rate-limit.server'
import { withSecurityHeaders } from '#/server/http/security-headers'
import { startWorker } from '#/server/publishing/worker'
import { validateCookieMutationOrigin } from '#/server/request-origin'

if (env.WORKER_ENABLED && process.env.npm_lifecycle_event !== 'build') {
  startWorker()
}

const startFetch = createStartHandler(defaultStreamHandler)

// TanStack Router localizes URLs via `rewrite`, so pass the original request.
// Using the middleware's delocalized request would double-rewrite and loop.
const fetch: typeof startFetch = async (req, ...args) => {
  const invalidOrigin = validateCookieMutationOrigin(req)
  if (invalidOrigin) return withSecurityHeaders(req, invalidOrigin)

  const rateLimited = await enforceCmsRateLimit(req)
  if (rateLimited) return withSecurityHeaders(req, rateLimited)

  const response = await paraglideMiddleware(req, () =>
    startFetch(req, ...args),
  )
  return withSecurityHeaders(req, response)
}

export type ServerEntry = { fetch: RequestHandler<Register> }

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(...args) {
      return await entry.fetch(...args)
    },
  }
}

export default createServerEntry({ fetch })
