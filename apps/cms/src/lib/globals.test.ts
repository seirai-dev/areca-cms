// Assumed API (apps/cms/src/lib/globals.ts), tests are the contract:
//   export const GLOBAL_ENTRY_SLUG = '$global'
//   export const GLOBAL_GROUP_MAX_LENGTH = 80
//   export const GLOBAL_PREVIEW_PATH_MAX_LENGTH = 512
//   export function isReservedGlobalKey(key: string): boolean
//     // 'globals' | 'resolve' | 'href' | 'preview' (case-insensitive)
//   export function isValidGlobalKey(key: string): boolean
//     // isSafeIdentifier(key) && !isReservedGlobalKey(key)
//   export function isValidPreviewPath(path: string): boolean
//   export function validateGlobalFields(
//     fields: Field[],
//   ): { path: string; message: string }[]   // [] when valid
import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'

import {
  GLOBAL_ENTRY_SLUG,
  GLOBAL_GROUP_MAX_LENGTH,
  GLOBAL_PREVIEW_PATH_MAX_LENGTH,
  isReservedGlobalKey,
  isValidGlobalKey,
  isValidPreviewPath,
  validateGlobalFields,
} from './globals'

describe('global entry slug', () => {
  it('is the constant $global slug every section entry uses', () => {
    expect(GLOBAL_ENTRY_SLUG).toBe('$global')
  })
})

describe('isValidGlobalKey', () => {
  it.each(['companyInfo', 'homePage', 'about_page', 'stats-2026'])(
    'accepts %s',
    (key) => {
      expect(isValidGlobalKey(key)).toBe(true)
    },
  )

  it.each([
    'globals',
    'Globals',
    'resolve',
    'href',
    'preview',
    'Preview',
    'previewGlobals',
    'preview-globals',
    'preview_globals',
  ])(
    'rejects the reserved key %s',
    (key) => {
      expect(isValidGlobalKey(key)).toBe(false)
      expect(isReservedGlobalKey(key)).toBe(true)
    },
  )

  it.each(['constructor', '__proto__', '1abc', 'company info', '../escape'])(
    'rejects the unsafe key %s',
    (key) => {
      expect(isValidGlobalKey(key)).toBe(false)
    },
  )

  it('does not reserve ordinary names', () => {
    expect(isReservedGlobalKey('companyInfo')).toBe(false)
    expect(isReservedGlobalKey('resolved')).toBe(false)
  })
})

describe('isValidPreviewPath', () => {
  it.each(['/', '/about', '/blog/post-1'])('accepts %s', (path) => {
    expect(isValidPreviewPath(path)).toBe(true)
  })

  it.each(['', 'about', 'https://example.test/about'])(
    'rejects %j (must start with a slash)',
    (path) => {
      expect(isValidPreviewPath(path)).toBe(false)
    },
  )

  it.each(['/about?draft=1', '/about#team'])(
    'rejects %s (no query or fragment)',
    (path) => {
      expect(isValidPreviewPath(path)).toBe(false)
    },
  )

  it('accepts a path of exactly the maximum length and rejects one longer', () => {
    expect(GLOBAL_PREVIEW_PATH_MAX_LENGTH).toBe(512)
    const atLimit = `/${'a'.repeat(GLOBAL_PREVIEW_PATH_MAX_LENGTH - 1)}`
    const overLimit = `/${'a'.repeat(GLOBAL_PREVIEW_PATH_MAX_LENGTH)}`
    expect(isValidPreviewPath(atLimit)).toBe(true)
    expect(isValidPreviewPath(overLimit)).toBe(false)
  })
})

describe('validateGlobalFields', () => {
  it('accepts ordinary field types and a group heading', () => {
    const fields: Field[] = [
      {
        key: 'email',
        label: 'Email',
        type: 'text',
        required: true,
        group: 'Contact',
      },
      {
        key: 'featured',
        label: 'Featured',
        type: 'reference',
        collection: 'x',
      },
    ]
    expect(validateGlobalFields(fields)).toEqual([])
  })

  it('rejects the slug field type', () => {
    const issues = validateGlobalFields([
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
    ])
    expect(issues).toEqual([expect.objectContaining({ path: 'slug' })])
  })

  it(`accepts a group of exactly ${GLOBAL_GROUP_MAX_LENGTH} characters`, () => {
    expect(GLOBAL_GROUP_MAX_LENGTH).toBe(80)
    expect(
      validateGlobalFields([
        {
          key: 'email',
          label: 'Email',
          type: 'text',
          group: 'g'.repeat(GLOBAL_GROUP_MAX_LENGTH),
        },
      ]),
    ).toEqual([])
  })

  it('rejects a group longer than the maximum', () => {
    const issues = validateGlobalFields([
      {
        key: 'email',
        label: 'Email',
        type: 'text',
        group: 'g'.repeat(GLOBAL_GROUP_MAX_LENGTH + 1),
      },
    ])
    expect(issues).toEqual([expect.objectContaining({ path: 'email' })])
  })
})
