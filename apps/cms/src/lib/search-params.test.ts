import { describe, expect, it } from 'vitest'
import { localeTagSchema } from './locale-tag-schema'
import { localeTagParam, optionalParam, z } from './search-params'
import { z as classic } from './zod'

describe('search param schemas', () => {
  const schema = z.object({
    tab: optionalParam(z.enum(['a', 'b'])),
    q: optionalParam(z.string().check(z.maxLength(5))),
    upload: optionalParam(z.coerce.number()),
    lang: optionalParam(localeTagParam),
  })
  const reference = classic.object({
    tab: classic.enum(['a', 'b']).optional().catch(undefined),
    q: classic.string().max(5).optional().catch(undefined),
    upload: classic.coerce.number().optional().catch(undefined),
    lang: localeTagSchema.optional().catch(undefined),
  })

  it.each([
    {},
    { tab: 'a', q: 'hey', upload: '3', lang: 'nl-BE' },
    { tab: 'c', q: 'too long', upload: 'x', lang: 'not a tag!' },
    { tab: 1, q: null, upload: 7, lang: '', extra: 'dropped' },
  ])('parses %j like the Zod classic schemas did', (input) => {
    expect(schema.parse(input)).toEqual(reference.parse(input))
  })
})
