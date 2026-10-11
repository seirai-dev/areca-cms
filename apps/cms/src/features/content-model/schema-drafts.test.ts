import { expect, it } from 'vitest'
import { draftsFromFields, fieldsFromDrafts } from './schema-drafts'

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
