import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

/**
 * Remembering the workspace between visits (brief §2 "/" resolver).
 *
 * - `areca.lastSite` cookie: the last site workspace visited. Read by the `/`
 *   resolver (server-side on first load, from `document.cookie` on client
 *   navigations) and validated against `me.sites` there.
 * - `areca.recentSites` localStorage: the workspace switcher's Recent list.
 *
 * UI support only; it stores ids the user can already see.
 */

const LAST_SITE_COOKIE = 'areca.lastSite'
const RECENT_KEY = 'areca.recentSites'
const RECENT_MAX = 5
const ONE_YEAR = 60 * 60 * 24 * 365

const getLastSiteCookieFn = createServerFn({ method: 'GET' }).handler(
  () => getCookie(LAST_SITE_COOKIE) ?? null,
)

function readClientCookie(name: string) {
  const prefix = `${name}=`
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length))
    }
  }
  return null
}

/** The last visited site id (not validated), on the server or the client. */
export async function readLastSiteId(): Promise<string | null> {
  if (typeof document !== 'undefined') return readClientCookie(LAST_SITE_COOKIE)
  try {
    return await getLastSiteCookieFn()
  } catch {
    return null
  }
}

export function readRecentSites(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

/** Called when a site workspace is visited. */
export function rememberSite(siteId: string) {
  try {
    document.cookie = `${LAST_SITE_COOKIE}=${encodeURIComponent(siteId)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
  } catch {
    /* cookies unavailable */
  }
  try {
    const next = [
      siteId,
      ...readRecentSites().filter((id) => id !== siteId),
    ].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* localStorage unavailable */
  }
}
