import { describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ site: null as unknown }))
vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
          limit: async () => [],
        }),
      }),
    }),
  },
}))
vi.mock('#/server/content/site-auth', () => ({
  authenticateSite: async () => auth.site,
}))

import { getSitesSnapshotCurrent } from './current'

describe('snapshot/current caching', () => {
  it('401 is no-store', async () => {
    auth.site = null
    const res = await getSitesSnapshotCurrent(
      new Request('http://cms.test/api/sites/snapshot/current'),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('404 (no publication) is no-store', async () => {
    auth.site = { id: 's', publishingMode: 'production' }
    const res = await getSitesSnapshotCurrent(
      new Request('http://cms.test/api/sites/snapshot/current'),
    )
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
