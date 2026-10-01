import { ssoClient } from '@better-auth/sso/client'
import {
  inferAdditionalFields,
  twoFactorClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import type { auth } from './auth.ts'

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    ssoClient(),
    twoFactorClient(),
  ],
})
