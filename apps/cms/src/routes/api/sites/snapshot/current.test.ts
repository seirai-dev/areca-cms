import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import { getSitesSnapshotCurrent } from './current'

const state = vi.hoisted(() => ({
  site: null as {
    id: string
    publishingMode: string
    organizationId?: string
    productionUrl?: string
  } | null,
  rows: [] as Array<{
    id: string
    siteId: string
    status: string
    snapshot: Record<string, unknown>
  }>,
}))
const selectRows = (condition: unknown) => {
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
    .map((row) => ({
      ...row,
      snapshotHash: row.snapshot.hash,
      hasAssets: 'assets' in row.snapshot,
    }))
}
vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          orderBy: () => ({ limit: async () => selectRows(condition) }),
          limit: async () => selectRows(condition),
        }),
      }),
    }),
  },
}))
vi.mock('#/server/content/site-auth', () => ({
  authenticateSite: async () => state.site,
}))
const snapshotAssets = vi.hoisted(() => vi.fn(async () => [{ id: 'derived' }]))
vi.mock('#/server/assets/published-assets', () => ({ snapshotAssets }))

const request = (query = '') =>
  new Request(`http://cms.test/api/sites/snapshot/current${query}`)
beforeEach(() => {
  snapshotAssets.mockClear()
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

  it('adds the site URL and the asset list, computing it for older publications', async () => {
    state.site = {
      id: 's',
      publishingMode: 'production',
      organizationId: 'org',
      productionUrl: 'https://www.acme.test/',
    }
    const collections = { articles: [] }
    state.rows = [
      {
        id: 'old',
        siteId: 's',
        status: 'live',
        snapshot: { hash: 'a', collections },
      },
    ]
    expect(
      await (await getSitesSnapshotCurrent(request())).json(),
    ).toMatchObject({
      assets: [{ id: 'derived' }],
      siteUrl: 'https://www.acme.test',
    })
    expect(snapshotAssets).toHaveBeenCalledWith('org', collections)

    snapshotAssets.mockClear()
    state.rows = [
      {
        id: 'new',
        siteId: 's',
        status: 'live',
        snapshot: { hash: 'b', collections, assets: [{ id: 'stored' }] },
      },
    ]
    expect(
      await (await getSitesSnapshotCurrent(request())).json(),
    ).toMatchObject({
      assets: [{ id: 'stored' }],
    })
    expect(snapshotAssets).not.toHaveBeenCalled()
  })

  it('sends an ETag for a stored publication and answers a match with 304', async () => {
    state.site = {
      id: 's',
      publishingMode: 'production',
      organizationId: 'org',
      productionUrl: 'https://www.acme.test/',
    }
    state.rows = [
      {
        id: 'p1',
        siteId: 's',
        status: 'live',
        snapshot: { hash: 'h1', collections: {}, assets: [] },
      },
    ]
    const first = await getSitesSnapshotCurrent(request())
    const etag = first.headers.get('ETag')
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/)
    expect(first.headers.get('Cache-Control')).toBe('private, no-cache')
    const body = await first.text()
    expect(body).toBe(
      JSON.stringify({
        hash: 'h1',
        collections: {},
        assets: [],
        publicationId: 'p1',
        siteUrl: 'https://www.acme.test',
      }),
    )

    for (const header of [etag!, `W/${etag}`, `"other", ${etag}`, '*']) {
      const again = await getSitesSnapshotCurrent(
        new Request('http://cms.test/api/sites/snapshot/current', {
          headers: { 'If-None-Match': header },
        }),
      )
      expect(again.status).toBe(304)
      expect(again.headers.get('ETag')).toBe(etag)
      expect(await again.text()).toBe('')
    }

    const stale = await getSitesSnapshotCurrent(
      new Request('http://cms.test/api/sites/snapshot/current', {
        headers: { 'If-None-Match': '"other"' },
      }),
    )
    expect(stale.status).toBe(200)
    expect(await stale.text()).toBe(body)

    // The site URL is part of the body, so a new one changes the tag.
    state.site.productionUrl = 'https://new.acme.test'
    const moved = await getSitesSnapshotCurrent(
      new Request('http://cms.test/api/sites/snapshot/current', {
        headers: { 'If-None-Match': etag! },
      }),
    )
    expect(moved.status).toBe(200)
    expect(moved.headers.get('ETag')).not.toBe(etag)
  })

  it('sends no ETag when the asset list is computed for an older publication', async () => {
    state.site = {
      id: 's',
      publishingMode: 'production',
      organizationId: 'org',
    }
    state.rows = [
      { id: 'old', siteId: 's', status: 'live', snapshot: { hash: 'a' } },
    ]
    const res = await getSitesSnapshotCurrent(
      new Request('http://cms.test/api/sites/snapshot/current', {
        headers: { 'If-None-Match': '*' },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toBeNull()
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
