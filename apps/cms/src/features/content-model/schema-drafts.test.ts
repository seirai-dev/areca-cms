import type { Field } from '#/lib/types'
import { describe, expect, it } from 'vitest'
import {
  draftTranslatable,
  draftsFromFields,
  fieldsFromDrafts,
  localizedRoutesFrom,
  requiredLanguagesFrom,
  routesDraftFrom,
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

describe('round trip keeps every stored property', () => {
  it('keeps the date-order constraint on a date field', () => {
    const stored: Field[] = [
      { key: 'opensAt', label: 'Opens', type: 'date' },
      { key: 'closesAt', label: 'Closes', type: 'date', after: 'opensAt' },
    ]
    expect(
      fieldsFromDrafts(draftsFromFields(stored, { kind: 'global' }), {
        kind: 'global',
      }),
    ).toEqual(stored)
  })

  it('keeps every property a section field can store', () => {
    const stored: Field[] = [
      {
        key: 'headline',
        label: 'Headline',
        type: 'text',
        required: true,
        description: 'Shown above the fold',
        group: 'Hero',
        translatable: false,
      },
      {
        key: 'category',
        label: 'Category',
        type: 'select',
        options: ['News', 'Events'],
      },
      {
        key: 'related',
        label: 'Related',
        type: 'reference',
        collection: 'posts',
      },
      { key: 'opensAt', label: 'Opens', type: 'datetime' },
      { key: 'closesAt', label: 'Closes', type: 'datetime', after: 'opensAt' },
    ]
    expect(
      fieldsFromDrafts(draftsFromFields(stored, { kind: 'global' }), {
        kind: 'global',
      }),
    ).toEqual(stored)
  })

  it('keeps the date-order constraint in a collection, next to the slug row', () => {
    const drafts = draftsFromFields([
      { key: 'opensAt', label: 'Opens', type: 'date' },
      { key: 'closesAt', label: 'Closes', type: 'date', after: 'opensAt' },
    ])
    expect(
      fieldsFromDrafts(drafts).find((field) => field.key === 'closesAt'),
    ).toEqual({
      key: 'closesAt',
      label: 'Closes',
      type: 'date',
      after: 'opensAt',
    })
  })
})

describe('translatable fields', () => {
  it('stores the switch only when it differs from the type default', () => {
    const fields = [
      { key: 'title', label: 'Title', type: 'text' as const },
      {
        key: 'title2',
        label: 'Title 2',
        type: 'text' as const,
        translatable: false,
      },
      {
        key: 'hero',
        label: 'Hero',
        type: 'image' as const,
        translatable: true,
      },
      {
        key: 'when',
        label: 'When',
        type: 'date' as const,
        translatable: false,
      },
    ]
    const saved = fieldsFromDrafts(draftsFromFields(fields))
    expect(saved.map((f) => [f.key, f.translatable])).toEqual([
      ['slug', undefined],
      ['title', undefined],
      ['title2', false],
      ['hero', true],
      ['when', undefined],
    ])
  })

  it('round-trips the explicit value through the draft', () => {
    const fields = [
      {
        key: 'title',
        label: 'Title',
        type: 'text' as const,
        translatable: false,
      },
      {
        key: 'hero',
        label: 'Hero',
        type: 'image' as const,
        translatable: true,
      },
    ]
    const again = fieldsFromDrafts(draftsFromFields(fields))
    expect(again.filter((f) => f.key !== 'slug')).toEqual(fields)
  })

  it('follows the new type default when the type changes and no value was set', () => {
    const [draft] = draftsFromFields([
      { key: 'x', label: 'X', type: 'text' as const },
    ]).slice(1)
    expect(draftTranslatable(draft)).toBe(true)
    expect(draftTranslatable({ ...draft, type: 'image' })).toBe(false)
  })

  it('never makes a slug translatable', () => {
    const [slug] = draftsFromFields(undefined)
    expect(draftTranslatable(slug)).toBe(false)
    expect(fieldsFromDrafts([slug])[0].translatable).toBeUndefined()
  })
})

describe('required languages and route patterns', () => {
  const languages = { main: 'nl', all: ['nl', 'en', 'fr'] }

  it('keeps only the non-main site languages, in site order', () => {
    expect(requiredLanguagesFrom(['fr', 'nl', 'en', 'de'], languages)).toEqual([
      'en',
      'fr',
    ])
    expect(requiredLanguagesFrom([], languages)).toEqual([])
  })

  it('drops blank patterns and the main language, and clears when none remain', () => {
    expect(
      localizedRoutesFrom(
        { nl: '/vacatures/$slug', en: ' /vacancies/$slug ', fr: '  ' },
        languages,
      ),
    ).toEqual({ en: '/vacancies/$slug' })
    expect(localizedRoutesFrom({ en: '', fr: ' ' }, languages)).toBeNull()
  })

  it('round-trips stored patterns through the draft', () => {
    const stored = { en: '/vacancies/$slug' }
    const draft = routesDraftFrom(stored)
    expect(localizedRoutesFrom(draft, languages)).toEqual(stored)
    expect(routesDraftFrom(null)).toEqual({})
  })
})
