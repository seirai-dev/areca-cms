import { EventEmitter } from 'node:events'
import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { createSessionLock } from './session-lock'

function fakePool(options: { failLock?: boolean; failUnlock?: boolean } = {}) {
  const queries: string[] = []
  const releases: Array<boolean | undefined> = []
  const client = Object.assign(new EventEmitter(), {
    query(sql: string) {
      queries.push(sql.includes('unlock') ? 'unlock' : 'lock')
      if (sql.includes('unlock') ? options.failUnlock : options.failLock) {
        return Promise.reject(new Error('query failed'))
      }
      return Promise.resolve({ rows: [] })
    },
    release(destroy?: boolean) {
      releases.push(destroy)
    },
  })
  let connects = 0
  const pool = {
    connect: () => {
      connects++
      return Promise.resolve(client)
    },
  } as unknown as Pick<Pool, 'connect'>
  return { pool, client, queries, releases, connects: () => connects }
}

describe('createSessionLock', () => {
  it('locks, runs, unlocks and returns the healthy connection', async () => {
    const fake = fakePool()
    const withLock = createSessionLock(fake.pool)
    await expect(withLock('k', () => Promise.resolve(7))).resolves.toBe(7)
    expect(fake.queries).toEqual(['lock', 'unlock'])
    expect(fake.releases).toEqual([false])
    expect(fake.client.listenerCount('error')).toBe(0)
  })

  it('unlocks and keeps the connection when run throws', async () => {
    const fake = fakePool()
    const withLock = createSessionLock(fake.pool)
    await expect(
      withLock('k', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')
    expect(fake.queries).toEqual(['lock', 'unlock'])
    expect(fake.releases).toEqual([false])
  })

  it('does not unlock when the lock was never taken, and discards the connection', async () => {
    const fake = fakePool({ failLock: true })
    const withLock = createSessionLock(fake.pool)
    let ran = false
    await expect(
      withLock('k', () => {
        ran = true
        return Promise.resolve()
      }),
    ).rejects.toThrow('query failed')
    expect(ran).toBe(false)
    expect(fake.queries).toEqual(['lock'])
    expect(fake.releases).toEqual([true])
  })

  it('fails the call on a connection error during run and discards the connection', async () => {
    const fake = fakePool()
    const withLock = createSessionLock(fake.pool)
    await expect(
      withLock('k', () => {
        fake.client.emit('error', new Error('connection lost'))
        return Promise.resolve('done')
      }),
    ).rejects.toThrow('connection lost')
    expect(fake.queries).toEqual(['lock', 'unlock'])
    expect(fake.releases).toEqual([true])
  })

  it('discards the connection when unlock fails but keeps the result', async () => {
    const fake = fakePool({ failUnlock: true })
    const withLock = createSessionLock(fake.pool)
    await expect(withLock('k', () => Promise.resolve(1))).resolves.toBe(1)
    expect(fake.releases).toEqual([true])
  })

  it('runs nested calls for the same key without locking again', async () => {
    const fake = fakePool()
    const withLock = createSessionLock(fake.pool)
    await withLock('k', () => withLock('k', () => Promise.resolve()))
    expect(fake.connects()).toBe(1)
    expect(fake.queries).toEqual(['lock', 'unlock'])
  })
})
