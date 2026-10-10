import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { getSitesSnapshotCurrent } from './current'

const state = vi.hoisted(() => ({
  site: null as { id: string; publishingMode: string } | null,
  rows: [] as Array<{
    id: string
    siteId: string
    status: string
    snapshot: Record<string, unknown>
  }>,
}))
vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          orderBy: () => ({
            limit: async () => {
              const query = new PgDialect().sqlToQuery(condition as never)
              const [siteId, selected] = query.params
              return state.rows
                .filter(
                  (row) =>
                    row.siteId === siteId &&
                    (query.sql.includes('"publication"."id"')
                      ? row.id === selected
                      : row.status === selected),
                )
                .slice(0, 1)
            },
          }),
        }),
      }),
    }),
  },
}))
vi.mock('#/server/content/site-auth', () => ({
  authenticateSite: async () => state.site,
}))

const request = (query = '') =>
  new Request(`http://cms.test/api/sites/snapshot/current${query}`)
beforeEach(() => {
  state.site = { id: 's', publishingMode: 'production' }
  state.rows = [
    {
      id: 'building',
      siteId: 's',
      status: 'building',
      snapshot: { hash: 'new' },
    },
    { id: 'live', siteId: 's', status: 'live', snapshot: { hash: 'old' } },
    {
      id: 'foreign',
      siteId: 'other',
      status: 'live',
      snapshot: { hash: 'foreign' },
    },
  ]
})

describe('snapshot/current publication selection and caching', () => {
  it('401 is no-store', async () => {
    state.site = null
    const res = await getSitesSnapshotCurrent(request())
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
  it('404 is no-store', async () => {
    state.rows = []
    const res = await getSitesSnapshotCurrent(request())
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
  it('ordinary pulls keep reading live while a new publication builds', async () => {
    expect(
      await (await getSitesSnapshotCurrent(request())).json(),
    ).toMatchObject({ publicationId: 'live', hash: 'old' })
  })
  it('an explicit build publication is frozen and never falls back', async () => {
    expect(
      await (
        await getSitesSnapshotCurrent(request('?publicationId=building'))
      ).json(),
    ).toMatchObject({ publicationId: 'building', hash: 'new' })
    expect(
      (await getSitesSnapshotCurrent(request('?publicationId=missing'))).status,
    ).toBe(404)
    expect(
      (await getSitesSnapshotCurrent(request('?publicationId=foreign'))).status,
    ).toBe(404)
    expect(
      (await getSitesSnapshotCurrent(request('?publicationId='))).status,
    ).toBe(400)
  })
  it('ordinary demo pulls use the successful demo publication', async () => {
    state.site = { id: 's', publishingMode: 'demo' }
    state.rows.push({
      id: 'demo',
      siteId: 's',
      status: 'demo',
      snapshot: { hash: 'demo' },
    })
    expect(
      await (await getSitesSnapshotCurrent(request())).json(),
    ).toMatchObject({ publicationId: 'demo' })
  })
})
