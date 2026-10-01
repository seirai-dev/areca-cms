import { describe, expect, it } from 'vitest'

import {
  ENTRY_DATA_MAX_BYTES,
  RICHTEXT_MAX_DEPTH,
  RICHTEXT_MAX_NODES,
  RICHTEXT_MAX_TEXT_LENGTH,
  TEXT_MAX_LENGTH,
} from '#/lib/content-limits'
import type { Field } from '#/lib/types'
import { validateRichText } from '#/server/richtext'

import {
  findUnknownKeys,
  pickDeclaredFields,
  validateEntryData,
} from './validation.ts'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'body', label: 'Body', type: 'richtext' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
]

function nested(depth: number) {
  // Built iteratively so the test itself cannot overflow the stack.
  let node: Record<string, unknown> = {
    type: 'paragraph',
    content: [{ type: 'text', text: 'x' }],
  }
  for (let i = 0; i < depth; i++) {
    node = { type: 'blockquote', content: [node] }
  }
  return { type: 'doc', content: [node] }
}

const base = { title: 'Hi', slug: 'hi' }

describe('unknown fields', () => {
  it('rejects unknown top-level keys on write', () => {
    const result = validateEntryData(
      fields,
      { ...base, extra: 1, __proto__x: 2 },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.path).sort()).toEqual([
        '__proto__x',
        'extra',
      ])
    }
  })

  it('rejects an own __proto__ key from JSON', () => {
    const data = JSON.parse('{"title":"a","slug":"a","__proto__":{"x":1}}')
    const result = validateEntryData(fields, data, {
      mode: 'partial',
      write: true,
    })
    expect(result.ok).toBe(false)
  })

  it('accepts declared keys only on write', () => {
    expect(
      validateEntryData(fields, base, { mode: 'partial', write: true }).ok,
    ).toBe(true)
  })

  it('strips unknown keys when validating stored data', () => {
    const result = validateEntryData(fields, {
      ...base,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      legacy: 'old',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).not.toHaveProperty('legacy')
  })

  it('pickDeclaredFields keeps declared keys only', () => {
    expect(pickDeclaredFields(fields, { ...base, legacy: 1 })).toEqual(base)
    expect(pickDeclaredFields(fields, {})).toEqual({})
    expect(findUnknownKeys(fields, { ...base, a: 1 })).toEqual(['a'])
  })
})

describe('rich text limits', () => {
  it('accepts a document at the maximum depth', () => {
    // doc + N blockquotes + paragraph + text = N + 3 levels
    expect(validateRichText(nested(RICHTEXT_MAX_DEPTH - 3))).toEqual([])
  })

  it('rejects one level deeper', () => {
    const errors = validateRichText(nested(RICHTEXT_MAX_DEPTH - 2))
    expect(errors.join()).toContain('nested deeper')
  })

  it('rejects 10,000 levels quickly without overflowing the stack', () => {
    const started = performance.now()
    const errors = validateRichText(nested(10_000))
    expect(errors.length).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('rejects a 200,000-level payload via the entry validator', () => {
    const result = validateEntryData(
      fields,
      { ...base, body: nested(200_000) },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
  })

  it('rejects too many nodes', () => {
    const paragraph = { type: 'paragraph' }
    const doc = {
      type: 'doc',
      content: Array.from({ length: RICHTEXT_MAX_NODES + 1 }, () => paragraph),
    }
    expect(validateRichText(doc).join()).toContain('nodes')
  })

  it('rejects too much text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a'.repeat(RICHTEXT_MAX_TEXT_LENGTH + 1) },
          ],
        },
      ],
    }
    expect(validateRichText(doc).join()).toContain('characters')
  })

  it('bounds the number of reported errors', () => {
    const doc = {
      type: 'doc',
      content: Array.from({ length: 5_000 }, () => ({ type: 'bogus' })),
    }
    expect(validateRichText(doc).length).toBeLessThanOrEqual(51)
  })
})

describe('size limits', () => {
  it('rejects entry data over the total size limit on write', () => {
    const chunk = 'a'.repeat(40_000)
    const result = validateEntryData(
      fields,
      { ...base, notes: chunk },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(true)
    const big = {
      ...base,
      body: {
        type: 'doc',
        content: Array.from({ length: 30 }, () => ({
          type: 'paragraph',
          content: [{ type: 'text', text: 'a'.repeat(40_000) }],
        })),
      },
    }
    expect(JSON.stringify(big).length).toBeGreaterThan(ENTRY_DATA_MAX_BYTES)
    const rejected = validateEntryData(fields, big, {
      mode: 'partial',
      write: true,
    })
    expect(rejected.ok).toBe(false)
  })

  it('rejects over-long text fields', () => {
    const result = validateEntryData(
      fields,
      { ...base, title: 'a'.repeat(TEXT_MAX_LENGTH + 1) },
      { mode: 'partial', write: true },
    )
    expect(result.ok).toBe(false)
  })
})
