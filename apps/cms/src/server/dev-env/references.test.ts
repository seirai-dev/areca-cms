import { describe, expect, it } from 'vitest'

import type { Field } from '#/lib/types'

import {
  referenceLookup,
  referenceTargets,
  remapReferences,
} from './references'

const fields: Field[] = [
  { key: 'title', label: 'Title', type: 'text' },
  {
    key: 'related',
    label: 'Related',
    type: 'reference',
    collection: 'articles',
  },
]

const lookup = (devId: string) => ({ d1: 'p1', d2: 'new-2' })[devId]

describe('remapReferences', () => {
  it('maps a top-level reference through the lookup', () => {
    const result = remapReferences(
      { title: 'x', related: 'd1' },
      fields,
      lookup,
    )
    expect(result.data).toEqual({ title: 'x', related: 'p1' })
    expect(result.cleared).toEqual([])
  })

  it('clears a reference that cannot be mapped and reports it', () => {
    const result = remapReferences({ related: 'gone' }, fields, lookup)
    expect(result.data).toEqual({})
    expect(result.cleared).toEqual([{ field: 'related', devTargetId: 'gone' }])
  })

  it('maps references inside language slots and reports the locale', () => {
    const result = remapReferences(
      {
        related: 'd1',
        $i18n: {
          nl: { related: 'd2' },
          de: { related: 'nope' },
        },
      },
      fields,
      lookup,
    )
    expect(result.data).toEqual({
      related: 'p1',
      $i18n: { nl: { related: 'new-2' }, de: {} },
    })
    expect(result.cleared).toEqual([
      { field: 'related', locale: 'de', devTargetId: 'nope' },
    ])
  })

  it('leaves empty and non-string reference values alone', () => {
    const result = remapReferences({ related: '' }, fields, lookup)
    expect(result.data).toEqual({ related: '' })
    const numeric = remapReferences({ related: 3 }, fields, lookup)
    expect(numeric.data).toEqual({ related: 3 })
    expect(numeric.cleared).toEqual([])
  })

  it('does not touch other fields that happen to hold an id', () => {
    const result = remapReferences({ title: 'd1' }, fields, lookup)
    expect(result.data).toEqual({ title: 'd1' })
  })

  it('returns the same object when the collection has no reference fields', () => {
    const data = { title: 'd1' }
    const result = remapReferences(data, [fields[0]], lookup)
    expect(result.data).toBe(data)
  })

  it('does not mutate its input', () => {
    const data = { related: 'd1', $i18n: { nl: { related: 'd2' } } }
    remapReferences(data, fields, lookup)
    expect(data).toEqual({ related: 'd1', $i18n: { nl: { related: 'd2' } } })
  })
})

describe('referenceTargets', () => {
  it('maps forked entries to their origin while the origin row exists', () => {
    const targets = referenceTargets(
      [
        { id: 'd1', originEntryId: 'p1' },
        { id: 'd3', originEntryId: 'gone' },
        { id: 'd4', originEntryId: null },
      ],
      new Set(['p1']),
      new Map(),
    )
    expect([...targets.entries()]).toEqual([['d1', 'p1']])
  })

  it('lets entries created by the push win over an origin', () => {
    const targets = referenceTargets(
      [{ id: 'd3', originEntryId: 'gone' }],
      new Set(),
      new Map([['d3', 'new-3']]),
    )
    expect(targets.get('d3')).toBe('new-3')
  })
})

describe('referenceLookup', () => {
  it('maps dev ids through the targets and keeps production ids that have no dev twin', () => {
    const resolve = referenceLookup(
      new Map([['d1', 'p1']]),
      new Set(['p1', 'p2']),
    )
    expect(resolve('d1')).toBe('p1')
    expect(resolve('p2')).toBe('p2')
    expect(resolve('gone')).toBeUndefined()
  })
})
