import { describe, expect, it } from 'vitest'

import { REQUIRED_SLUG_FIELD, withRequiredSlugField } from './collection-fields'

describe('withRequiredSlugField', () => {
  it('adds the canonical slug field first when it is missing', () => {
    expect(
      withRequiredSlugField([
        { key: 'title', label: 'Title', type: 'text', required: true },
      ]),
    ).toEqual([
      REQUIRED_SLUG_FIELD,
      { key: 'title', label: 'Title', type: 'text', required: true },
    ])
  })

  it('repairs an editable or incorrectly typed canonical slug field', () => {
    expect(
      withRequiredSlugField([
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'slug', label: 'URL', type: 'text' },
      ]),
    ).toEqual([
      REQUIRED_SLUG_FIELD,
      { key: 'title', label: 'Title', type: 'text' },
    ])
  })
})
