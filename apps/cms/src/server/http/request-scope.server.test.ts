import { describe, expect, it, vi } from 'vitest'

import {
  forgetForRequest,
  memoizeForRequest,
  withRequestScope,
} from './request-scope.server.ts'

describe('request scope', () => {
  it('runs a load once per request and shares its promise', async () => {
    const load = vi.fn(async () => 'value')
    await withRequestScope(async () => {
      const first = memoizeForRequest('k', load)
      const second = memoizeForRequest('k', load)
      expect(second).toBe(first)
      await expect(first).resolves.toBe('value')
    })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never shares a memo between two requests', async () => {
    const load = vi.fn(async () => 'value')
    await withRequestScope(() => memoizeForRequest('k', load))
    await withRequestScope(() => memoizeForRequest('k', load))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('memoizes nothing outside a request scope', async () => {
    const load = vi.fn(async () => 'value')
    await memoizeForRequest('k', load)
    await memoizeForRequest('k', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed load', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce('recovered')
    await withRequestScope(async () => {
      await expect(memoizeForRequest('k', load)).rejects.toThrow(
        'database unavailable',
      )
      await expect(memoizeForRequest('k', load)).resolves.toBe('recovered')
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('forgets a memo so the next caller loads again', async () => {
    const load = vi.fn(async () => 'value')
    await withRequestScope(async () => {
      await memoizeForRequest('k', load)
      forgetForRequest('k')
      await memoizeForRequest('k', load)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
