import { describe, expect, it } from 'vitest'

import { contentRoute } from './content-route'

describe('contentRoute', () => {
  it('opens a site content section on its page', () => {
    expect(
      contentRoute({
        siteId: 's1',
        collectionKey: 'footer',
        entryId: 'e1',
        global: true,
      }),
    ).toEqual({
      to: '/sites/$siteId/globals/$globalKey',
      params: { siteId: 's1', globalKey: 'footer' },
    })
  })

  it('opens a collection entry in the entry editor', () => {
    expect(
      contentRoute({
        siteId: 's1',
        collectionKey: 'posts',
        entryId: 'e1',
        global: false,
      }),
    ).toEqual({
      to: '/sites/$siteId/c/$collectionKey/$entryId',
      params: { siteId: 's1', collectionKey: 'posts', entryId: 'e1' },
    })
  })
})
