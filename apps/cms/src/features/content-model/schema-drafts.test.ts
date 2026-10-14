import { describe, expect, it } from 'vitest'
import {
  draftsFromFields,
  fieldsFromDrafts,
  validateFieldDrafts,
} from './schema-drafts'

// Assumed API (red phase): the optional second argument picks the schema kind.
//   draftsFromFields(fields | undefined, { kind })
//   validateFieldDrafts(drafts, { kind })   // per-row errors, may include `type` and `group`
//   fieldsFromDrafts(drafts, { kind })
// FieldDraft gains `group: string` (empty when unset).

it('round-trips commas, quotes, whitespace and Unicode choice labels', () => {
  const options = ['Research, development', '"Quoted"', '  Spaced  ', 'Café']
  expect(
    fieldsFromDrafts(
      draftsFromFields([
        { key: 'category', label: 'Category', type: 'select', options },
      ]),
    ).find((f) => f.key === 'category')?.options,
  ).toEqual(options)
})
it('preserves independent choice edits and drops empty rows', () => {
  const drafts = draftsFromFields([
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      options: ['One, two', 'Three'],
    },
  ])
  const field = drafts.find((f) => f.key === 'category')!
  field.options[1] = 'Four, five'
  field.options.push('  ')
  expect(
    fieldsFromDrafts(drafts).find((f) => f.key === 'category')?.options,
  ).toEqual(['One, two', 'Four, five'])
})

describe('global (site content) mode', () => {
  it('does not force a slug row on a new section', () => {
    const drafts = draftsFromFields(undefined, { kind: 'global' })
    expect(drafts.some((d) => d.type === 'slug')).toBe(false)
    expect(drafts).toHaveLength(0)
    expect(fieldsFromDrafts(drafts, { kind: 'global' })).toEqual([])
  })

  it('still forces the slug row for collections', () => {
    const drafts = draftsFromFields(undefined, { kind: 'collection' })
    expect(drafts.map((d) => d.type)).toEqual(['slug'])
  })

  it('rejects a slug field in a section', () => {
    const drafts = draftsFromFields(
      [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
      { kind: 'global' },
    )
    const errors = validateFieldDrafts(drafts, { kind: 'global' })
    expect(errors).toHaveProperty('0.type')
  })

  it('accepts ordinary field types without a slug row', () => {
    const drafts = draftsFromFields(
      [
        { key: 'email', label: 'Email', type: 'text', required: true },
        { key: 'phone', label: 'Phone', type: 'text' },
      ],
      { kind: 'global' },
    )
    expect(validateFieldDrafts(drafts, { kind: 'global' })).toEqual({})
  })

  it('carries a group heading through to the saved fields', () => {
    const drafts = draftsFromFields(
      [
        {
          key: 'email',
          label: 'Email',
          type: 'text',
          required: true,
          group: 'Contact',
        },
        { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
        { key: 'name', label: 'Name', type: 'text' },
      ],
      { kind: 'global' },
    )
    expect(validateFieldDrafts(drafts, { kind: 'global' })).toEqual({})
    const fields = fieldsFromDrafts(drafts, { kind: 'global' })
    expect(fields.map((f) => f.group)).toEqual([
      'Contact',
      'Contact',
      undefined,
    ])
  })

  it('accepts a group heading of exactly 80 characters', () => {
    const group = 'g'.repeat(80)
    const drafts = draftsFromFields(
      [{ key: 'email', label: 'Email', type: 'text', group }],
      { kind: 'global' },
    )
    expect(validateFieldDrafts(drafts, { kind: 'global' })).toEqual({})
    expect(fieldsFromDrafts(drafts, { kind: 'global' })[0].group).toBe(group)
  })

  it('rejects a group heading over 80 characters', () => {
    const drafts = draftsFromFields(
      [{ key: 'email', label: 'Email', type: 'text', group: 'g'.repeat(81) }],
      { kind: 'global' },
    )
    expect(validateFieldDrafts(drafts, { kind: 'global' })).toHaveProperty(
      '0.group',
    )
  })

  it('treats a blank group heading as no group', () => {
    const drafts = draftsFromFields(
      [{ key: 'email', label: 'Email', type: 'text', group: '   ' }],
      { kind: 'global' },
    )
    expect(
      fieldsFromDrafts(drafts, { kind: 'global' })[0].group,
    ).toBeUndefined()
  })
})

describe('collection mode and group headings', () => {
  it('does not allow a group heading on collection fields', () => {
    const drafts = draftsFromFields(
      [
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'title', label: 'Title', type: 'text', group: 'Contact' },
      ],
      { kind: 'collection' },
    )
    const errors = validateFieldDrafts(drafts, { kind: 'collection' })
    const saved = fieldsFromDrafts(drafts, { kind: 'collection' })
    // Either rejected on validation, or dropped from the saved fields.
    const rejected = errors[1]?.group !== undefined
    expect(rejected || saved[1].group === undefined).toBe(true)
  })

  it('keeps the collection default unchanged without options', () => {
    const drafts = draftsFromFields(undefined)
    expect(drafts.map((d) => d.type)).toEqual(['slug'])
    expect(fieldsFromDrafts(drafts)[0].group).toBeUndefined()
  })
})
