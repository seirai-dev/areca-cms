/**
 * Deterministic JSON: object keys sorted, otherwise `JSON.stringify`'s rules
 * (undefined members are dropped). The published content hash is built on
 * this exact output, so it must not change. With `undefinedAsNull`, undefined
 * members and values are written as null instead.
 */
export function stableStringify(
  value: unknown,
  { undefinedAsNull = false } = {},
): string {
  return JSON.stringify(sortKeys(value, undefinedAsNull))
}

/** Deep equality of JSON-shaped values, ignoring object key order. */
export function stableEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function sortKeys(value: unknown, undefinedAsNull: boolean): unknown {
  if (value === undefined && undefinedAsNull) return null
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item, undefinedAsNull))
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined && !undefinedAsNull) continue
      out[key] = sortKeys(source[key], undefinedAsNull)
    }
    return out
  }
  return value
}
