import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

import { sanitizeErrorsMiddleware } from '#/server/http/error-middleware'

// Server functions are same-origin RPC endpoints. The middleware accepts a
// request whose Sec-Fetch-Site is same-origin, or whose Origin (or Referer,
// when neither header is sent) matches the request's own origin; anything else
// gets 403. Plain routes keep the cookie origin check in server.ts.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [sanitizeErrorsMiddleware],
}))
