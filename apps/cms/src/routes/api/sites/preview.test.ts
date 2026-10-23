import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSitesPreview } from './preview'

// Assumed API: buildPreviewGlobal(siteId, key) -> SnapshotGlobal | null (draft data).
const state = vi.hoisted(
  (): {
    rows: unknown[]
    entry: unknown
    global: unknown
    verify: unknown
    calls: unknown[]
  } => ({
    rows: [],
    entry: null,
    global: null,
    verify: null,
    calls: [],
  }),
)

vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => state.rows }) }),
    }),
  },
}))
vi.mock('#/server/content/snapshot', () => ({
  buildPreviewEntry: async (...args: unknown[]) => {
    state.calls.push(['entry', args])
    return state.entry
  },
  buildPreviewGlobal: async (...args: unknown[]) => {
    state.calls.push(['global', args])
    return state.global
  },
}))
vi.mock('#/server/content/preview-token', () => ({
  decodePreviewToken: (token: string) =>
    token === 'bad' ? null : { siteId: 'site-1' },
  verifyPreviewToken: () => state.verify,
}))

const req = (token?: string, locale?: string) => {
  const params = new URLSearchParams()
  if (token) params.set('token', token)
  if (locale) params.set('locale', locale)
  const query = params.toString()
  return new Request(
    `http://cms.test/api/sites/preview${query ? `?${query}` : ''}`,
  )
}

function expectNoStore(res: Response) {
  expect(res.headers.get('Cache-Control')).toBe('no-store, private')
  expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
}

describe('preview API caching', () => {
  beforeEach(() => {
    state.rows = [{ id: 'site-1', previewSecret: 's' }]
    state.entry = { title: 'Draft' }
    state.global = {
      id: 'entry-1',
      slug: '$global',
      data: { email: 'a@x.test' },
    }
    state.verify = { siteId: 'site-1', collection: 'posts', slug: 'a' }
  })

  it('sets no-store on a missing token (401)', async () => {
    const res = await getSitesPreview(req())
    expect(res.status).toBe(401)
    expectNoStore(res)
  })

  it('sets no-store on an undecodable token (401)', async () => {
    const res = await getSitesPreview(req('bad'))
    expect(res.status).toBe(401)
    expectNoStore(res)
  })

  it('sets no-store on an unknown site (401)', async () => {
    state.rows = []
    const res = await getSitesPreview(req('t'))
    expect(res.status).toBe(401)
    expectNoStore(res)
  })

  it('sets no-store on an invalid signature (401)', async () => {
    state.verify = null
    const res = await getSitesPreview(req('t'))
    expect(res.status).toBe(401)
    expectNoStore(res)
  })

  it('sets no-store on a missing entry (404)', async () => {
    state.entry = null
    const res = await getSitesPreview(req('t'))
    expect(res.status).toBe(404)
    expectNoStore(res)
  })

  it('sets no-store on success (200)', async () => {
    const res = await getSitesPreview(req('t'))
    expect(res.status).toBe(200)
    expectNoStore(res)
    expect(await res.json()).toMatchObject({
      kind: 'entry',
      collection: 'posts',
      slug: 'a',
    })
  })

  it('returns the section draft for a global token, with kind global', async () => {
    state.verify = { siteId: 'site-1', global: 'companyInfo' }
    const res = await getSitesPreview(req('t'))
    expect(res.status).toBe(200)
    expectNoStore(res)
    expect(await res.json()).toEqual({
      kind: 'global',
      global: 'companyInfo',
      entry: { id: 'entry-1', slug: '$global', data: { email: 'a@x.test' } },
    })
  })

  it('sets no-store on a global token whose section is missing (404)', async () => {
    state.verify = { siteId: 'site-1', global: 'missing' }
    state.global = null
    const res = await getSitesPreview(req('t'))
    expect(res.status).toBe(404)
    expectNoStore(res)
  })

  it('passes ?locale= to the entry preview, and it wins over the token locale', async () => {
    state.verify = {
      siteId: 'site-1',
      collection: 'posts',
      slug: 'a',
      locale: 'fr',
    }
    state.calls = []
    await getSitesPreview(req('t', 'en'))
    expect(state.calls.at(-1)).toEqual([
      'entry',
      ['site-1', 'posts', 'a', 'en'],
    ])
  })

  it('falls back to the token locale when the query has none', async () => {
    state.verify = {
      siteId: 'site-1',
      collection: 'posts',
      slug: 'a',
      locale: 'fr',
    }
    state.calls = []
    await getSitesPreview(req('t'))
    expect(state.calls.at(-1)).toEqual([
      'entry',
      ['site-1', 'posts', 'a', 'fr'],
    ])
  })

  it('passes the locale to a section preview', async () => {
    state.verify = { siteId: 'site-1', global: 'companyInfo', locale: 'nl' }
    state.calls = []
    await getSitesPreview(req('t'))
    expect(state.calls.at(-1)).toEqual([
      'global',
      ['site-1', 'companyInfo', 'nl'],
    ])
  })
})
