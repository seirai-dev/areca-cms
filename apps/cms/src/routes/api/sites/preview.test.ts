import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  entry: null as unknown,
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
    expect(await res.json()).toMatchObject({ collection: 'posts', slug: 'a' })
  })
})
