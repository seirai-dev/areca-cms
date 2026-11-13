import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFingerprintCache } from './release-diff-cache.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('createFingerprintCache', () => {
  it('rebuilds when the fingerprint changes', async () => {
    const cache = createFingerprintCache<number>({ max: 10, maxAgeMs: 60_000 })
    let builds = 0
    const compute = async () => ++builds
    expect(await cache.get('s', 'a', compute)).toBe(1)
    expect(await cache.get('s', 'a', compute)).toBe(1)
    expect(await cache.get('s', 'b', compute)).toBe(2)
  })

  it('shares one build between concurrent misses', async () => {
    const cache = createFingerprintCache<number>({ max: 10, maxAgeMs: 60_000 })
    const compute = vi.fn(async () => 7)
    const results = await Promise.all([
      cache.get('s', 'a', compute),
      cache.get('s', 'a', compute),
    ])
    expect(results).toEqual([7, 7])
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failed build', async () => {
    const cache = createFingerprintCache<number>({ max: 10, maxAgeMs: 60_000 })
    await expect(
      cache.get('s', 'a', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')
    expect(await cache.get('s', 'a', async () => 3)).toBe(3)
  })

  it('drops the least recently used site past the limit', async () => {
    const cache = createFingerprintCache<string>({ max: 2, maxAgeMs: 60_000 })
    await cache.get('a', 'f', async () => 'a1')
    await cache.get('b', 'f', async () => 'b1')
    await cache.get('a', 'f', async () => 'a2')
    await cache.get('c', 'f', async () => 'c1')
    expect(cache.size).toBe(2)
    expect(await cache.get('a', 'f', async () => 'a3')).toBe('a1')
    expect(await cache.get('b', 'f', async () => 'b2')).toBe('b2')
  })

  it('rebuilds a value older than the maximum age', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const cache = createFingerprintCache<number>({ max: 10, maxAgeMs: 1_000 })
    let builds = 0
    const compute = async () => ++builds
    await cache.get('s', 'a', compute)
    vi.setSystemTime(Date.now() + 2_000)
    expect(await cache.get('s', 'a', compute)).toBe(2)
  })
})
