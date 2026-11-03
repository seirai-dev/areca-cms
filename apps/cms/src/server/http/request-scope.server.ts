import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Per-request memo for lookups that several guards repeat within one HTTP
 * request, the Better Auth session above all. `src/server.ts` opens a scope
 * around every request, so a memo lives exactly as long as that request. Outside
 * a scope (tests, the publishing worker, anything at boot) nothing is memoized
 * and every call reads fresh.
 *
 * A scope is used instead of a WeakMap keyed by `getRequest()`: the rate limiter
 * runs before TanStack Start creates its request context, so it does not see the
 * same request object that server functions see.
 */
const scopes = new AsyncLocalStorage<Map<string, Promise<unknown>>>()

/** Memo key for the Better Auth session of the request being handled. */
export const SESSION_MEMO_KEY = 'better-auth:session'

type RequestInfo = { id?: string; method?: string }

/** Request facts per scope, kept beside the memo so `forgetForRequest` cannot drop them. */
const requestInfo = new WeakMap<object, RequestInfo>()

export function withRequestScope<T>(run: () => T, info: RequestInfo = {}): T {
  const memo = new Map<string, Promise<unknown>>()
  requestInfo.set(memo, info)
  return scopes.run(memo, run)
}

function currentInfo(): RequestInfo | undefined {
  const memo = scopes.getStore()
  return memo ? requestInfo.get(memo) : undefined
}

/** The id of the request being handled (`X-Request-Id`), for log lines. */
export function currentRequestId(): string | undefined {
  return currentInfo()?.id
}

/**
 * True while handling a GET or HEAD request. Reads may trust the session
 * cookie cache; anything that writes reads the session from the database.
 * Outside a request scope this is false, so the session is read fresh.
 */
export function isReadOnlyRequest(): boolean {
  const method = currentInfo()?.method
  return method === 'GET' || method === 'HEAD'
}

/**
 * Runs `load` once per request for `key` and shares its promise with every
 * later caller in that request. A failed load is not kept, so the next caller
 * tries again.
 */
export function memoizeForRequest<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const memo = scopes.getStore()
  if (!memo) return load()
  const cached = memo.get(key)
  if (cached) return cached as Promise<T>
  const pending = load()
  memo.set(key, pending)
  pending.catch(() => {
    if (memo.get(key) === pending) memo.delete(key)
  })
  return pending
}

/**
 * Drops a memo so the next caller in this request reads fresh. Call it after
 * anything that changes what the same request would now see (a session ended,
 * a sign-in or sign-out handled).
 */
export function forgetForRequest(key: string) {
  scopes.getStore()?.delete(key)
}
