import { describe, expect, it } from 'vitest'
import { StepUpQueue } from './step-up-queue'

describe('queued confirmations', () => {
  it('settles overlapping requests in order without overwriting a waiter', async () => {
    let active: number | undefined
    const queue = new StepUpQueue((current) => {
      active = current?.id
    })
    const settled: number[] = []
    const first = queue.ask().then(() => settled.push(1))
    const second = queue.ask().then(() => settled.push(2))
    expect(active).toBe(1)
    queue.settle(1, true)
    await first
    expect(settled).toEqual([1])
    expect(active).toBe(2)
    queue.settle(2, true)
    await second
    expect(settled).toEqual([1, 2])
    expect(active).toBeUndefined()
  })
  it('canceling one request keeps the next available', async () => {
    const queue = new StepUpQueue(() => {})
    const first = queue.ask().catch(() => 'canceled')
    const second = queue.ask()
    queue.settle(1, false)
    expect(await first).toBe('canceled')
    queue.settle(2, true)
    await expect(second).resolves.toBeUndefined()
  })
  it('ignores late proof for a canceled confirmation while the next waits', async () => {
    let active: number | undefined
    const queue = new StepUpQueue((current) => {
      active = current?.id
    })
    const first = queue.ask().catch(() => 'canceled')
    let secondAccepted = false
    const second = queue.ask().then(() => {
      secondAccepted = true
    })
    let finishFirst!: () => void
    const firstProof = new Promise<void>((resolve) => {
      finishFirst = resolve
    }).then(() => queue.settle(1, true))
    queue.settle(1, false)
    expect(await first).toBe('canceled')
    expect(active).toBe(2)
    finishFirst()
    await firstProof
    expect(secondAccepted).toBe(false)
    expect(active).toBe(2)
    queue.settle(2, true)
    await second
    expect(secondAccepted).toBe(true)
  })
  it('unmount rejects every outstanding confirmation', async () => {
    const queue = new StepUpQueue(() => {})
    const requests = [queue.ask(), queue.ask()].map((request) =>
      request.catch(() => 'canceled'),
    )
    queue.dispose()
    expect(await Promise.all(requests)).toEqual(['canceled', 'canceled'])
  })
})
