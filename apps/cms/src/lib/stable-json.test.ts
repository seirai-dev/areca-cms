import { describe, expect, it } from 'vitest'

import { stableEqual, stableStringify } from './stable-json'

describe('stableStringify', () => {
  it('sorts object keys at every depth', () => {
    expect(stableStringify({ b: [{ d: 1, c: 2 }], a: 1 })).toBe(
      '{"a":1,"b":[{"c":2,"d":1}]}',
    )
  })

  it('follows JSON.stringify for undefined members and array holes', () => {
    expect(stableStringify({ a: undefined, b: [undefined] })).toBe(
      '{"b":[null]}',
    )
  })

  it('writes undefined as null when asked', () => {
    expect(
      stableStringify(
        { a: undefined, b: [undefined] },
        { undefinedAsNull: true },
      ),
    ).toBe('{"a":null,"b":[null]}')
    expect(stableStringify(undefined, { undefinedAsNull: true })).toBe('null')
  })
})

describe('stableEqual', () => {
  it('ignores key order and undefined members', () => {
    expect(stableEqual({ b: 2, a: 1 }, { a: 1, b: 2, c: undefined })).toBe(true)
    expect(stableEqual({ a: null }, {})).toBe(false)
  })
})
