import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'

import { buildSnapshotSchema } from './snapshot-schema.ts'

const fields: Field[] = [
  { key: 'slug', label: 'Slug', type: 'slug', required: true },
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'cover-image', label: 'Cover', type: 'image' },
]

describe('buildSnapshotSchema', () => {
  it('keys each collection by its raw key with route, label and fields', () => {
    expect(
      buildSnapshotSchema([
        {
          key: 'blog-posts',
          label: 'Blog posts',
          routePattern: '/blog/$slug',
          fields,
        },
      ]),
    ).toEqual({
      'blog-posts': { route: '/blog/$slug', label: 'Blog posts', fields },
    })
  })

  it('returns an empty object when there are no collections', () => {
    expect(buildSnapshotSchema([])).toEqual({})
  })

  it('copies fields so later mutation of the source does not leak in', () => {
    const source = [{ key: 'title', label: 'Title', type: 'text' as const }]
    const schema = buildSnapshotSchema([
      {
        key: 'notes',
        label: 'Notes',
        routePattern: '/n/$slug',
        fields: source,
      },
    ])
    source[0].label = 'Changed'
    expect(schema.notes?.fields[0]?.label).toBe('Title')
  })
})
