import { describe, expect, it } from 'vitest'

import { liveRequestBody } from './use-live-preview'

const data = { title: 'Hello' } as never

describe('liveRequestBody', () => {
  it('builds an entry body with entryId and collection', () => {
    const body = liveRequestBody({
      siteId: 'site_1',
      target: { kind: 'entry', collection: 'posts', entryId: 'entry_1' },
      data,
      locale: 'en',
    })
    expect(body).toEqual({
      siteId: 'site_1',
      entryId: 'entry_1',
      collection: 'posts',
      data,
      locale: 'en',
    })
  })

  it('builds a global body with no collection or entryId keys', () => {
    const body = liveRequestBody({
      siteId: 'site_1',
      target: { kind: 'global', global: 'home' },
      data,
      locale: null,
    })
    expect(body).toEqual({
      siteId: 'site_1',
      global: 'home',
      data,
      locale: null,
    })
    expect('collection' in body).toBe(false)
    expect('entryId' in body).toBe(false)
  })
})
