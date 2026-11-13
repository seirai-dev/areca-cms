import { afterEach, describe, expect, it, vi } from 'vitest'

import { readStored, writeStored } from './use-stored-state'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  }
}

const blocked = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readStored / writeStored', () => {
  it('reads null on the server', () => {
    expect(readStored('stored-test:server')).toBeNull()
  })

  it('reads and writes localStorage, and null removes the key', () => {
    const storage = memoryStorage({ 'stored-test:a': 'cards' })
    vi.stubGlobal('window', { localStorage: storage })
    expect(readStored('stored-test:a')).toBe('cards')
    writeStored('stored-test:a', 'list')
    expect(storage.data.get('stored-test:a')).toBe('list')
    expect(readStored('stored-test:a')).toBe('list')
    writeStored('stored-test:a', null)
    expect(storage.data.has('stored-test:a')).toBe(false)
    expect(readStored('stored-test:a')).toBeNull()
  })

  it('never throws when storage is blocked, and keeps the write for this page', () => {
    vi.stubGlobal('window', { localStorage: blocked })
    expect(readStored('stored-test:b')).toBeNull()
    expect(() => writeStored('stored-test:b', 'on')).not.toThrow()
    expect(readStored('stored-test:b')).toBe('on')
  })
})
