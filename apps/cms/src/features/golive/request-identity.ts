type StoredRequest = { key: string; payload: string }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const completed = new Set<string>()
const fallback = new Map<string, StoredRequest>()

/** Keep uncertain requests through remounts and reloads, scoped to the actor. */
export function publishingRequestIdentity(
  actorId: string,
  siteId: string,
  operation: 'publish' | 'rollback',
  payload: string,
  storage?: StorageLike,
) {
  const scope = `areca:publishing-request:${actorId}:${siteId}:${operation}`
  let previous = fallback.get(scope)
  if (storage) {
    const stored = storage.getItem(scope)
    if (stored) {
      const parsed: unknown = JSON.parse(stored)
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('key' in parsed) ||
        typeof parsed.key !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          parsed.key,
        ) ||
        !('payload' in parsed) ||
        typeof parsed.payload !== 'string'
      ) {
        throw new Error(
          'Stored publishing request identity is invalid; recover the original request before publishing',
        )
      }
      if (!completed.has(parsed.key))
        previous = { key: parsed.key, payload: parsed.payload }
    }
  }
  if (previous && previous.payload !== payload) {
    throw new Error(
      'Retry the unresolved publishing request before changing its options',
    )
  }
  const request = previous ?? { key: crypto.randomUUID(), payload }
  // If persistence is unavailable, fail before making the RPC rather than
  // losing the key after an ambiguous response.
  storage?.setItem(scope, JSON.stringify(request))
  fallback.set(scope, request)
  return {
    key: request.key,
    complete() {
      if (fallback.get(scope)?.key !== request.key) return
      completed.add(request.key)
      fallback.delete(scope)
      // A confirmed response remains successful even if storage cleanup fails.
      // A reload may replay the old key safely, rather than dispatching twice.
      try {
        storage?.removeItem(scope)
      } catch {
        /* Retry can replace the completed key in this session. */
      }
    },
  }
}
