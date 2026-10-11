import {
  defaultParseSearch,
  defaultStringifySearch,
} from '@tanstack/react-router'

/**
 * OAuth authorization queries contain signed, opaque strings. Router's default
 * JSON decoder changes values such as `1e3` or `[1, 2]`, invalidating their
 * signature. Keep every value and repetition as a string for these queries;
 * ordinary application searches retain the default JSON behavior.
 */

function isSignedOAuthSearch(search: Record<string, unknown>): boolean {
  return (
    typeof search.sig === 'string' &&
    typeof search.exp === 'string' &&
    typeof search.client_id === 'string'
  )
}

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
  if (isSignedOAuthSearch(search)) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === 'string') params.append(key, value)
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') params.append(key, item)
        }
      }
    }
    const query = params.toString()
    return query ? `?${query}` : ''
  }

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

/** Decode signed query values without JSON coercion or losing repetitions. */
export function parseSearchKeepingRepeats(
  searchStr: string,
): Record<string, unknown> {
  const params = new URLSearchParams(searchStr.replace(/^\?/, ''))
  if (!params.has('sig') || !params.has('exp') || !params.has('client_id')) {
    return defaultParseSearch(searchStr)
  }
  const search: Record<string, unknown> = Object.create(null)
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    search[key] = values.length === 1 ? values[0] : values
  }
  return search
}
