import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import type { RequestHandler } from '@tanstack/react-start/server'

import { paraglideMiddleware } from '#/paraglide/server.js'

const startFetch = createStartHandler(defaultStreamHandler)

// The middleware sets the request's locale from the URL prefix, so server
// rendering and prerendering of `/nl/...` pages see Dutch. The original
// request goes on: TanStack Router localizes URLs itself (see router.tsx).
const fetch: RequestHandler<Register> = (req, ...args) =>
  paraglideMiddleware(req, () => startFetch(req, ...args))

export default { fetch }
