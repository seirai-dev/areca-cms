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

/**
 * Names the generated content object uses for its own members. Only collection
 * and site content keys are restricted; a field may still be called `preview`,
 * `href` or `resolve`. `globals` is the generated accessor for site content.
 * Stored lowercase; `previewglobals` is `content.previewGlobals` folded.
 * `in`, `languages` and `matchlocale` are the content languages members
 * (`content.in()`, `content.languages`, `content.matchLocale()`).
 */
const reservedCollectionKeys = new Set([
  'resolve',
  'href',
  'preview',
  'globals',
  'previewglobals',
  'previewfrom',
  'in',
  'languages',
  'matchlocale',
])

/**
 * The key's name as a member of the generated object: the SDK camelCases
 * `preview-globals` and `preview_globals` to `previewGlobals` before it checks
 * reserved names. Dropping separators and lowercasing gives the same fold as
 * `toCamelKey` followed by a lowercase compare.
 */
function memberNameForm(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase()
}

export function isReservedCollectionKey(key: string): boolean {
  return reservedCollectionKeys.has(memberNameForm(key))
}

export function isSafeIdentifier(value: string): boolean {
  return (
    /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
    !reserved.has(value.toLowerCase())
  )
}

export function assertSafeIdentifier(value: string): void {
  if (!isSafeIdentifier(value))
    throw new Error(`Unsafe collection or field identifier: ${value}`)
}
