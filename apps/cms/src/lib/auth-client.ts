import { ssoClient } from '@better-auth/sso/client'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import {
  inferAdditionalFields,
  twoFactorClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import type { auth } from './auth.ts'

export const authClient = createAuthClient({
  // The app reads the user from `me` (lib/me-query.ts); `useSession` callers
  // only need it once per mount, not again on every tab focus.
  sessionOptions: { refetchOnWindowFocus: false },
  plugins: [
    inferAdditionalFields<typeof auth>(),
    ssoClient(),
    twoFactorClient(),
    // Attaches the signed authorization query from the page (`?sig=…`) to
    // sign-in requests, so a sign-in started from an AI app resumes it.
    oauthProviderClient(),
  ],
})
