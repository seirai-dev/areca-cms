import {
  defaultParseSearch,
  defaultStringifySearch,
} from '@tanstack/react-router'

/**
 * Search (de)serialisation for the router, with one fix. The default writes an
 * array as a single JSON value, but a repeated key (`ba_param=a&ba_param=b`)
 * reads back as an array. Better Auth's signed authorization query repeats
 * keys, so the router rewrote it on load, and its signature stopped matching:
 * an AI app's sign-in then failed.
 *
 * Arrays of two or more plain strings are therefore written back as repeated
 * keys, which read back as the same array. Everything else keeps the default
 * encoding, so existing URLs are unchanged.
 */

/** True when a decoded value of this shape would read back identically. */
function isRepeatable(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((item) => typeof item === 'string' && !decodesAsOther(item))
  )
}

/** Query values that the decoder turns into a number or boolean. */
function decodesAsOther(text: string): boolean {
  if (text === 'true' || text === 'false') return true
  return text !== '' && +text * 0 === 0 && +text + '' === text
}

export function stringifySearchKeepingRepeats(
  search: Record<string, unknown>,
): string {
  const plain: Record<string, unknown> = {}
  const repeated: [string, string[]][] = []
  for (const [key, value] of Object.entries(search)) {
    if (isRepeatable(value)) repeated.push([key, value])
    else plain[key] = value
  }
  if (repeated.length === 0) return defaultStringifySearch(search)

  const params = new URLSearchParams(defaultStringifySearch(plain).slice(1))
  for (const [key, values] of repeated) {
    for (const value of values) params.append(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Reads search strings as the router always has (repeats become arrays). */
export const parseSearchKeepingRepeats = defaultParseSearch
