import { createServerFn } from '@tanstack/react-start'

import type { AuthMethods } from '#/lib/auth-providers'
import { enabledAuthMethods } from '#/lib/auth-providers'

/**
 * The sign-in page only renders what the environment actually enabled, so the
 * server is the single source of truth for which methods exist.
 */
export const getAuthMethodsFn = createServerFn({
  method: 'GET',
  strict: { output: false },
}).handler(async (): Promise<AuthMethods> => enabledAuthMethods())
