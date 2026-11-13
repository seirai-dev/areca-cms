import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'

import { validateContentDefinitions } from './content-definitions.ts'
import { ValidationError } from './errors.ts'

function validateCollectionDefinitions(
  defs: { key: string; fields: Field[]; enabled?: boolean }[],
) {
  validateContentDefinitions(
    defs.map((def) => ({ ...def, kind: 'collection' as const })),
  )
}

function issuesOf(run: () => void) {
  try {
    run()
  } catch (error) {
    if (error instanceof ValidationError) return error.errors
    throw error
  }
  return []
}

describe('validateCollectionDefinitions (globals rules)', () => {
  it('rejects a group heading on a collection field', () => {
    const fields: Field[] = [
      { key: 'title', label: 'Title', type: 'text', group: 'Contact' },
    ]
    const issues = issuesOf(() =>
      validateCollectionDefinitions([{ key: 'articles', fields }]),
    )
    expect(issues).toEqual([
      expect.objectContaining({ path: 'articles.title' }),
    ])
  })

  it('rejects the reserved collection key globals', () => {
    const issues = issuesOf(() =>
      validateCollectionDefinitions([
        {
          key: 'globals',
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
      ]),
    )
    expect(issues).toEqual([expect.objectContaining({ path: 'globals' })])
  })

  it.each(['previewGlobals', 'preview-globals', 'preview_globals'])(
    'rejects the collection key %s, which camelCases to the reserved previewGlobals',
    (key) => {
      const issues = issuesOf(() =>
        validateCollectionDefinitions([
          {
            key,
            fields: [{ key: 'title', label: 'Title', type: 'text' }],
          },
        ]),
      )
      expect(issues).toEqual([expect.objectContaining({ path: key })])
    },
  )

  it('still accepts a collection without groups', () => {
    expect(() =>
      validateCollectionDefinitions([
        {
          key: 'articles',
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
      ]),
    ).not.toThrow()
  })
})
