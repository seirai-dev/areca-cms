import { beforeEach, expect, it, vi } from 'vitest'
import {
  clearPendingSiteTokens,
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
    get length() {
      return storage.size
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
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
  writePendingToken('user', 'org', a)
  writePendingToken('user', 'org', b)
  expect(readPendingTokens('user', 'org')).toEqual([a, b])
  removePendingToken('user', 'org', 'a')
  expect(readPendingTokens('user', 'org')).toEqual([b])
  expect(readPendingTokens('user', 'other')).toEqual([])
})

it("never shows one user's credentials to another user in the same tab", () => {
  writePendingToken('user-1', 'org', {
    siteId: 'a',
    siteName: 'A',
    token: 'build-a',
  })
  expect(readPendingTokens('user-2', 'org')).toEqual([])
  expect(readPendingTokens('user-1', 'org')).toHaveLength(1)
})

it("clears every user's credentials and nothing else", () => {
  writePendingToken('user-1', 'org', { siteId: 'a', siteName: 'A', token: 'x' })
  writePendingToken('user-2', 'org', { siteId: 'b', siteName: 'B', token: 'y' })
  storage.set('other-key', 'keep')
  clearPendingSiteTokens()
  expect([...storage.keys()]).toEqual(['other-key'])
})
it('retains legacy pending credentials when adding a new site', () => {
  storage.set(
    'areca.site-token.user.org',
    JSON.stringify({ siteName: 'Old', token: 'old' }),
  )
  writePendingToken('user', 'org', {
    siteId: 'new',
    siteName: 'New',
    token: 'build',
    schemaToken: 'schema',
  })
  expect(readPendingTokens('user', 'org')).toHaveLength(2)
  expect(readPendingTokens('user', 'org')[0]).toMatchObject({
    siteId: 'old',
    token: 'old',
  })
})
it('handles malformed or unavailable storage', () => {
  storage.set('areca.site-token.user.org', '{bad')
  expect(readPendingTokens('user', 'org')).toEqual([])
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw Error('disabled')
    },
    setItem: () => {
      throw Error('disabled')
    },
  })
  expect(() =>
    writePendingToken('user', 'org', {
      siteId: 's',
      siteName: 'S',
      token: 't',
    }),
  ).not.toThrow()
})
