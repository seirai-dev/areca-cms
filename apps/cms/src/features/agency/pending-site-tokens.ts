/** One-time credentials awaiting confirmation, independently stored per site. */
export type PendingToken = {
  siteId: string
  siteName: string
  token: string
  schemaToken?: string
}
const tokenKey = (orgId: string) => `areca.site-token.${orgId}`
export function readPendingTokens(orgId: string): PendingToken[] {
  try {
    const raw = sessionStorage.getItem(tokenKey(orgId))
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
function persist(orgId: string, values: PendingToken[]) {
  try {
    if (values.length)
      sessionStorage.setItem(tokenKey(orgId), JSON.stringify(values))
    else sessionStorage.removeItem(tokenKey(orgId))
  } catch {
    /* The on-screen reveal remains available when storage is disabled. */
  }
}
export function writePendingToken(orgId: string, value: PendingToken) {
  persist(orgId, [
    ...readPendingTokens(orgId).filter((item) => item.siteId !== value.siteId),
    value,
  ])
}
export function removePendingToken(orgId: string, siteId: string) {
  persist(
    orgId,
    readPendingTokens(orgId).filter((item) => item.siteId !== siteId),
  )
}
