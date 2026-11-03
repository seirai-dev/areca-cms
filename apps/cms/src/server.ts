import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

import { env } from '#/env'
import { paraglideMiddleware } from '#/paraglide/server.js'
import { enforceCmsRateLimit } from '#/server/http/rate-limit.server'
import { withRequestScope } from '#/server/http/request-scope.server'
import { createCspNonce, withCspNonce } from '#/server/http/csp-nonce'
import { withSecurityHeaders } from '#/server/http/security-headers'
import { getSetupStatus } from '#/server/admin/setup'
import { handleDiscoveryRequest } from '#/server/mcp/discovery'
import { createLogger } from '#/server/log'
import { startWorker } from '#/server/publishing/worker'
import { validateCookieMutationOrigin } from '#/server/request-origin'

if (env.WORKER_ENABLED && process.env.npm_lifecycle_event !== 'build') {
  startWorker()
}

// Print the generated first-run setup token at boot instead of on the first
// page visit. Non-fatal: the setup page still resolves it on demand.
if (process.env.npm_lifecycle_event !== 'build') {
  void getSetupStatus().catch((error) =>
    createLogger('setup').warn('could not check setup status at boot', {
      err: error,
    }),
  )
}

const startFetch = createStartHandler(defaultStreamHandler)

// Each request gets its own CSP nonce. The router reads it while building the
// page (see getRouter), and the same nonce goes into this response's header.
// TanStack Router localizes URLs via `rewrite`, so pass the original request.
// Using the middleware's delocalized request would double-rewrite and loop.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const httpLog = createLogger('http')

const fetch: typeof startFetch = (req, ...args) => {
  const nonce = createCspNonce()
  const started = performance.now()
  // A proxy-supplied id is kept so proxy and app logs can be matched;
  // otherwise one is made here. Every log line of the request carries it.
  const incomingId = req.headers.get('x-request-id')
  const requestId =
    incomingId && REQUEST_ID_PATTERN.test(incomingId)
      ? incomingId
      : crypto.randomUUID()
  const secure = (response: Response) => {
    const secured = withSecurityHeaders(req, response, {
      nonce,
      reportOnly: env.CSP_REPORT_ONLY,
      development: import.meta.env.DEV,
    })
    secured.headers.set('X-Request-Id', requestId)
    if (secured.status >= 500) {
      httpLog.warn('request failed', {
        requestId,
        method: req.method,
        path: new URL(req.url).pathname,
        status: secured.status,
        ms: Math.round(performance.now() - started),
      })
    }
    return secured
  }

  // The request scope lets the rate limiter and every guard share one session
  // lookup per request (see `request-scope.server.ts`).
  return withCspNonce(nonce, () =>
    withRequestScope(
      async () => {
        const invalidOrigin = validateCookieMutationOrigin(req, [
          env.BETTER_AUTH_URL,
          env.APP_URL,
        ])
        if (invalidOrigin) return secure(invalidOrigin)

        // OAuth discovery documents live at the origin root, which file routing does
        // not serve reliably for dot-folders such as `.well-known`.
        const discovery = await handleDiscoveryRequest(req)
        if (discovery) return secure(discovery)

        const rateLimited = await enforceCmsRateLimit(req)
        if (rateLimited) return secure(rateLimited)

        const response = await paraglideMiddleware(req, () =>
          startFetch(req, ...args),
        )
        return secure(response)
      },
      { id: requestId, method: req.method },
    ),
  )
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
