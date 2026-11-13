import { useCallback, useSyncExternalStore } from 'react'

/**
 * Browser-remembered UI state in localStorage. Every access is guarded, so
 * SSR, private modes and blocked storage never throw: a value written while
 * storage is blocked lasts for this page. All hooks on one key stay in step,
 * across tabs too.
 */

// What this page wrote. It wins over localStorage, which may refuse writes.
const written = new Map<string, string | null>()
const listeners = new Set<() => void>()

export function readStored(key: string): string | null {
  if (written.has(key)) return written.get(key) ?? null
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** `null` removes the key. */
export function writeStored(key: string, value: string | null) {
  written.set(key, value)
  if (typeof window !== 'undefined') {
    try {
      if (value === null) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, value)
    } catch {
      /* localStorage unavailable: the value lasts for this page */
    }
  }
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key === null) written.clear()
  else written.delete(event.key)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

/** How a stored string maps to a value. Keep one at module scope. */
export type StoredCodec<T> = {
  /** `raw` is null when the key is missing. */
  parse: (raw: string | null) => T
  /** Null removes the key. */
  serialize: (value: T) => string | null
}

/**
 * `[value, setValue]` for one stored key. The server render and hydration
 * show `options.serverValue` (default: `parse(null)`); the stored value
 * follows right after.
 */
export function useStoredState<T, TServer = T>(
  key: string,
  { parse, serialize }: StoredCodec<T>,
  options?: { serverValue: TServer },
): readonly [T | TServer, (next: T) => void] {
  const raw = useSyncExternalStore<string | null | undefined>(
    subscribe,
    () => readStored(key),
    () => undefined,
  )
  const value =
    raw === undefined && options ? options.serverValue : parse(raw ?? null)
  const setValue = useCallback(
    (next: T) => writeStored(key, serialize(next)),
    [key, serialize],
  )
  return [value, setValue]
}
