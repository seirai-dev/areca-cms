import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

// The production site is fully prerendered static files. This only matters
// for `pnpm dev`, where pages are rendered on demand.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [csrfMiddleware],
  }
})
