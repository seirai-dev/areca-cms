import { describe, expect, it } from 'vitest'

import { checkInBatches, LINK_CHECK_BATCH } from './link-check-batches'

function pairs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    entryId: `entry-${index}`,
    anchor: null,
  }))
}

describe('checkInBatches', () => {
  it('checks every link, in batches the server accepts, and keeps their order', async () => {
    const calls: number[] = []
    const all = pairs(LINK_CHECK_BATCH + 1)
    const results = await checkInBatches(all, async (batch) => {
      calls.push(batch.length)
      return batch.map((pair) => pair.entryId)
    })
    expect(calls).toEqual([LINK_CHECK_BATCH, 1])
    expect(results).toEqual(all.map((pair) => pair.entryId))
  })

  it('makes one call for a text with few links, and none without links', async () => {
    const calls: number[] = []
    const check = async (batch: { entryId: string }[]) => {
      calls.push(batch.length)
      return batch.map((pair) => pair.entryId)
    }
    await checkInBatches(pairs(3), check)
    await checkInBatches([], check)
    expect(calls).toEqual([3])
  })

  it('never sends more than the batch size, for a text with many links', async () => {
    const sizes: number[] = []
    const results = await checkInBatches(pairs(501), async (batch) => {
      sizes.push(batch.length)
      return batch.map((pair) => pair.entryId)
    })
    expect(sizes).toEqual([200, 200, 101])
    expect(results).toHaveLength(501)
  })
})
