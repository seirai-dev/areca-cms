const reserved = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'manifest',
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

export function isSafeIdentifier(value: string): boolean {
  return (
    /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
    !reserved.has(value.toLowerCase())
  )
}

/** Names the generated content object uses itself, so collections cannot take them. */
const reservedCollectionKeys = new Set(['resolve', 'href', 'preview'])

/** Case-insensitive. Field keys may use these names; collection keys may not. */
export function isReservedCollectionKey(key: string): boolean {
  return reservedCollectionKeys.has(key.toLowerCase())
}

export function assertSafeIdentifier(value: string): void {
  if (!isSafeIdentifier(value))
    throw new Error(`Unsafe collection or field identifier: ${value}`)
}

/** Filesystem collection names must also be unique on Mac and Windows. */
export function assertUniqueCollectionIdentifiers(
  keys: Iterable<string>,
): void {
  const seen = new Map<string, string>()
  for (const key of keys) {
    assertSafeIdentifier(key)
    const folded = key.toLowerCase()
    const previous = seen.get(folded)
    if (previous !== undefined) {
      throw new Error(
        `Collection identifiers differ only by case: ${previous}, ${key}`,
      )
    }
    seen.set(folded, key)
  }
}
