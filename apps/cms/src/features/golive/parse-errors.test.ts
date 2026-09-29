import { describe, expect, it } from 'vitest'

import { parseGoLiveError } from './parse-errors'

describe('parseGoLiveError', () => {
  it('splits collection, slug, field and message', () => {
    expect(
      parseGoLiveError('articles/spring-launch: cover: asset not found'),
    ).toEqual({
      raw: 'articles/spring-launch: cover: asset not found',
      collection: 'articles',
      slug: 'spring-launch',
      field: 'cover',
      message: 'asset not found',
    })
  })

  it('handles errors without a field', () => {
    expect(parseGoLiveError('pages/about: missing published data')).toMatchObject({
      collection: 'pages',
      slug: 'about',
      field: undefined,
      message: 'missing published data',
    })
  })

  it('keeps anything else as a plain message', () => {
    expect(
      parseGoLiveError('Route collision: /blog/$slug slug "a" used by x and y'),
    ).toEqual({
      raw: 'Route collision: /blog/$slug slug "a" used by x and y',
      message: 'Route collision: /blog/$slug slug "a" used by x and y',
    })
  })
})
