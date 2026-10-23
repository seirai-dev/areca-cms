import { authClient } from './auth-client'
import { clearPendingSiteTokens } from './pending-site-tokens'

/**
 * The one sign-out for the browser. Every sign-out path calls it, so tab-scoped
 * secrets (one-time site credentials) are dropped before the session ends.
 */
export async function signOutClient() {
  clearPendingSiteTokens()
  await authClient.signOut()
}
