import { createStart } from '@tanstack/react-start'

import { sanitizeErrorsMiddleware } from '#/server/http/error-middleware'

export const startInstance = createStart(() => ({
  functionMiddleware: [sanitizeErrorsMiddleware],
}))
