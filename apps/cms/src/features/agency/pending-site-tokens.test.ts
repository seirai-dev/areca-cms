import { beforeEach, expect, it, vi } from 'vitest'
import {
  readPendingTokens,
  removePendingToken,
  writePendingToken,
} from './pending-site-tokens'

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  })
})
it('keeps both credentials for every site and removes only the confirmed site', () => {
  const a = {
      siteId: 'a',
      siteName: 'A',
      token: 'build-a',
      schemaToken: 'schema-a',
    },
    b = {
      siteId: 'b',
      siteName: 'B',
      token: 'build-b',
      schemaToken: 'schema-b',
    }
  writePendingToken('org', a)
  writePendingToken('org', b)
  expect(readPendingTokens('org')).toEqual([a, b])
  removePendingToken('org', 'a')
  expect(readPendingTokens('org')).toEqual([b])
  expect(readPendingTokens('other')).toEqual([])
})
it('retains legacy pending credentials when adding a new site', () => {
  storage.set(
    'areca.site-token.org',
    JSON.stringify({ siteName: 'Old', token: 'old' }),
  )
  writePendingToken('org', {
    siteId: 'new',
    siteName: 'New',
    token: 'build',
    schemaToken: 'schema',
  })
  expect(readPendingTokens('org')).toHaveLength(2)
  expect(readPendingTokens('org')[0]).toMatchObject({
    siteId: 'old',
    token: 'old',
  })
})
it('handles malformed or unavailable storage', () => {
  storage.set('areca.site-token.org', '{bad')
  expect(readPendingTokens('org')).toEqual([])
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw Error('disabled')
    },
    setItem: () => {
      throw Error('disabled')
    },
  })
  expect(() =>
    writePendingToken('org', { siteId: 's', siteName: 'S', token: 't' }),
  ).not.toThrow()
})
