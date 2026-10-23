import { beforeEach, expect, it, vi } from 'vitest'

import { writePendingToken } from './pending-site-tokens'
import { signOutClient } from './sign-out'

const shared = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  keysAtSignOut: [] as string[][],
}))

vi.mock('./auth-client', () => ({
  authClient: {
    signOut: async () => {
      shared.keysAtSignOut.push([...shared.storage.keys()])
    },
  },
}))

const { storage } = shared
beforeEach(() => {
  storage.clear()
  shared.keysAtSignOut = []
  vi.stubGlobal('sessionStorage', {
    get length() {
      return storage.size
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  })
})

it('clears pending site credentials before ending the session', async () => {
  writePendingToken('user-1', 'org', {
    siteId: 's',
    siteName: 'S',
    token: 'build',
  })
  storage.set('unrelated', 'keep')
  await signOutClient()
  expect(shared.keysAtSignOut).toEqual([['unrelated']])
  expect([...storage.keys()]).toEqual(['unrelated'])
})
