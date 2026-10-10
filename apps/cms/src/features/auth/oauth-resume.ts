import { authClient } from '#/lib/auth-client'
import { m } from '#/paraglide/messages'

/**
 * Sign-in started by an AI app (OAuth 2.1 authorization). The authorization
 * request is sent to /login with a signed query string; once the user has a
 * session, the plugin's `oauth2/continue` picks the request up again and
 * answers with where to go next (the consent screen, or the app's redirect).
 */

/** The signed authorization query on a location search string, or null. */
export function oauthQueryFromSearch(searchStr: string): string | null {
  const query = searchStr.replace(/^\?/, '')
  if (!query) return null
  const params = new URLSearchParams(query)
  return params.has('sig') && params.has('exp') && params.has('client_id')
    ? query
    : null
}

/** A `{ redirect: true, url }` answer, which the client follows by itself. */
export function isPluginRedirect(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const body = data as Record<string, unknown>
  return body.redirect === true && typeof body.url === 'string'
}

/** The URL the plugin wants the browser sent to, if the response names one. */
export function redirectUrlFrom(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const body = data as Record<string, unknown>
  if (body.redirect === true && typeof body.url === 'string') return body.url
  if (typeof body.redirect_uri === 'string') return body.redirect_uri
  return null
}

/**
 * Resumes a signed authorization after sign-in (password, second factor, or a
 * provider round trip). Rejects with the expired-link message when the signed
 * query is no longer valid.
 */
export async function continueOAuth(query: string): Promise<string> {
  const result = await authClient.$fetch<unknown>('/oauth2/continue', {
    method: 'POST',
    body: { postLogin: true, oauth_query: query },
  })
  const url = result.error ? null : redirectUrlFrom(result.data)
  if (!url) throw new Error(m.auth_oauth_link_expired())
  return url
}
