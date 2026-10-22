import { describe, expect, it, vi } from 'vitest'

import { runBulkAction } from './use-collection-entries'

const targets = [
  { id: 'a', title: 'Alpha', slug: 'alpha' },
  { id: 'b', title: 'Beta', slug: 'beta' },
  { id: 'c', title: 'Gamma', slug: 'gamma' },
]

describe('runBulkAction', () => {
  it('reports every entry as done when all calls succeed', async () => {
    const call = vi.fn(async (_id: string) => undefined)
    const result = await runBulkAction({ action: 'ready', targets }, call)
    expect(call.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c'])
    expect(result).toEqual({
      action: 'ready',
      ids: ['a', 'b', 'c'],
      total: 3,
      done: 3,
      failed: [],
    })
  })

  it('keeps going after a failure and names each failed entry with its reason', async () => {
    const call = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('Slug already exists')
      if (id === 'c') throw 'not an error object'
    })
    const result = await runBulkAction({ action: 'draft', targets }, call)
    expect(call.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c'])
    expect(result.total).toBe(3)
    expect(result.done).toBe(1)
    expect(result.failed).toEqual([
      { id: 'a', title: 'Alpha', slug: 'alpha', reason: 'Slug already exists' },
      {
        id: 'c',
        title: 'Gamma',
        slug: 'gamma',
        reason: expect.any(String) as string,
      },
    ])
  })

  it('reports nothing done when every call fails', async () => {
    const result = await runBulkAction(
      { action: 'delete', targets },
      async () => {
        throw new Error('Forbidden')
      },
    )
    expect(result.done).toBe(0)
    expect(result.failed.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})
