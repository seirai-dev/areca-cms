/** One-time credentials awaiting confirmation, independently stored per site. */
export type PendingToken = {
  siteId: string
  siteName: string
  token: string
  schemaToken?: string
}

const KEY_PREFIX = 'areca.site-token.'
// Keyed by the signed-in user as well as the organization, so a second user in
// the same tab never reads the first user's credentials.
const tokenKey = (userId: string, orgId: string) =>
  `${KEY_PREFIX}${userId}.${orgId}`

export function readPendingTokens(
  userId: string,
  orgId: string,
): PendingToken[] {
  try {
    const raw = sessionStorage.getItem(tokenKey(userId, orgId))
    if (!raw) return []
    const decoded: unknown = /^[{[]/.test(raw)
      ? JSON.parse(raw)
      : { token: raw, siteName: '' }
    return (Array.isArray(decoded) ? decoded : [decoded]).flatMap((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.token !== 'string' ||
        typeof item.siteName !== 'string'
      )
        return []
      return [
        {
          siteId: typeof item.siteId === 'string' ? item.siteId : item.token,
          siteName: item.siteName,
          token: item.token,
          ...(typeof item.schemaToken === 'string'
            ? { schemaToken: item.schemaToken }
            : {}),
        },
      ]
    })
  } catch {
    return []
  }
}

function persist(userId: string, orgId: string, values: PendingToken[]) {
  try {
    if (values.length)
      sessionStorage.setItem(tokenKey(userId, orgId), JSON.stringify(values))
    else sessionStorage.removeItem(tokenKey(userId, orgId))
  } catch {
    /* The on-screen reveal remains available when storage is disabled. */
  }
}

export function writePendingToken(
  userId: string,
  orgId: string,
  value: PendingToken,
) {
  persist(userId, orgId, [
    ...readPendingTokens(userId, orgId).filter(
      (item) => item.siteId !== value.siteId,
    ),
    value,
  ])
}

export function removePendingToken(
  userId: string,
  orgId: string,
  siteId: string,
) {
  persist(
    userId,
    orgId,
    readPendingTokens(userId, orgId).filter((item) => item.siteId !== siteId),
  )
}

/** Drops every user's pending credentials from this tab. Called on sign-out. */
export function clearPendingSiteTokens() {
  try {
    const stale: string[] = []
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(KEY_PREFIX)) stale.push(key)
    }
    for (const key of stale) sessionStorage.removeItem(key)
  } catch {
    /* Storage disabled: nothing was kept. */
  }
}
