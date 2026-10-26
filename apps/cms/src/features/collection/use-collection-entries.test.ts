import { describe, expect, it, vi } from 'vitest'

import { BULK_ENTRY_MAX_IDS } from '#/lib/content-limits'

import { runBulkAction } from './use-collection-entries'

const targets = [
  { id: 'a', title: 'Alpha', slug: 'alpha' },
  { id: 'b', title: 'Beta', slug: 'beta' },
  { id: 'c', title: 'Gamma', slug: 'gamma' },
]

/** A server answer where every id succeeds, or fails with the reasons given. */
function answer(failures: Record<string, string> = {}) {
  return async (ids: string[]) =>
    ids.map((id) =>
      id in failures
        ? { id, ok: false, error: failures[id] }
        : { id, ok: true },
    )
}

describe('runBulkAction', () => {
  it('reports every entry as done when the server reports no failures', async () => {
    const run = vi.fn(answer())
    const result = await runBulkAction({ action: 'ready', targets }, run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toEqual(['a', 'b', 'c'])
    expect(result).toEqual({
      action: 'ready',
      ids: ['a', 'b', 'c'],
      total: 3,
      done: 3,
      failed: [],
    })
  })

  it('names each entry the server could not change with its reason', async () => {
    const result = await runBulkAction(
      { action: 'archive', targets },
      answer({ a: 'Slug already exists' }),
    )
    expect(result.total).toBe(3)
    expect(result.done).toBe(2)
    expect(result.failed).toEqual([
      { id: 'a', title: 'Alpha', slug: 'alpha', reason: 'Slug already exists' },
    ])
  })

  it('marks an entry the response leaves out as failed', async () => {
    const result = await runBulkAction(
      { action: 'draft', targets },
      async () => [
        { id: 'a', ok: true },
        { id: 'b', ok: true },
      ],
    )
    expect(result.done).toBe(2)
    expect(result.failed.map((item) => item.id)).toEqual(['c'])
  })

  it('splits large selections into batches of the server limit', async () => {
    const many = Array.from({ length: BULK_ENTRY_MAX_IDS + 5 }, (_, index) => ({
      id: `e${index}`,
      title: `Entry ${index}`,
      slug: `entry-${index}`,
    }))
    const run = vi.fn(answer())
    const result = await runBulkAction({ action: 'delete', targets: many }, run)
    expect(run.mock.calls.map(([ids]) => ids.length)).toEqual([
      BULK_ENTRY_MAX_IDS,
      5,
    ])
    expect(result.done).toBe(BULK_ENTRY_MAX_IDS + 5)
  })

  it('fails only the batch whose request threw, and runs the others', async () => {
    const many = Array.from({ length: BULK_ENTRY_MAX_IDS + 1 }, (_, index) => ({
      id: `e${index}`,
      title: `Entry ${index}`,
      slug: `entry-${index}`,
    }))
    let call = 0
    const result = await runBulkAction(
      { action: 'ready', targets: many },
      async (ids) => {
        call += 1
        if (call === 1) throw new Error('Network down')
        return ids.map((id) => ({ id, ok: true }))
      },
    )
    expect(result.done).toBe(1)
    expect(result.failed).toHaveLength(BULK_ENTRY_MAX_IDS)
    expect(result.failed[0]?.reason).toBe('Network down')
  })

  it('reports nothing done when every entry fails', async () => {
    const result = await runBulkAction(
      { action: 'delete', targets },
      answer({
        a: 'Forbidden',
        b: 'Forbidden',
        c: 'Forbidden',
      }),
    )
    expect(result.done).toBe(0)
    expect(result.failed.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})
