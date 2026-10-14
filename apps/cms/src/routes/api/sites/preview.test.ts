import { beforeEach, describe, expect, it, vi } from 'vitest'

// Assumed API: buildPreviewGlobal(siteId, key) -> SnapshotGlobal | null (draft data).
const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  entry: null as unknown,
  global: null as unknown,
  verify: null as unknown,
}))

vi.mock('#/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => state.rows }) }),
    }),
  },
}))
vi.mock('#/server/content/snapshot', () => ({
  buildPreviewEntry: async () => state.entry,
  buildPreviewGlobal: async () => state.global,
}))
vi.mock('#/server/content/preview-token', () => ({
  decodePreviewToken: (token: string) =>
    token === 'bad' ? null : { siteId: 'site-1' },
  verifyPreviewToken: () => state.verify,
}))

import { getSitesPreview } from './preview'

const req = (token?: string) =>
  new Request(
    `http://cms.test/api/sites/preview${token ? `?token=${token}` : ''}`,
  )

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
})
