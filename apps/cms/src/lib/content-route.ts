export const GLOBAL_ROUTE = '/sites/$siteId/globals/$globalKey' as const
export const ENTRY_ROUTE = '/sites/$siteId/c/$collectionKey/$entryId' as const

/**
 * Where a piece of content opens: a site content section opens its page, a
 * collection entry opens in the entry editor. Spread into `<Link>` or pass
 * to `navigate`.
 */
export function contentRoute(target: {
  siteId: string
  collectionKey: string
  entryId: string
  global: boolean
}) {
  const { siteId, collectionKey, entryId } = target
  return target.global
    ? { to: GLOBAL_ROUTE, params: { siteId, globalKey: collectionKey } }
    : { to: ENTRY_ROUTE, params: { siteId, collectionKey, entryId } }
}
