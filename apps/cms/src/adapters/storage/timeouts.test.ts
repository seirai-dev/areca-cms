import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageTimeoutError, idleGuard } from './timeouts'

const IDLE_MS = 1000

// A source that errors when its request is aborted, as the S3 SDK does.
function sourceFrom(
  controller: AbortController,
  chunks: Uint8Array[],
  { stall = false } = {},
) {
  return new ReadableStream<Uint8Array>({
    start(out) {
      controller.signal.addEventListener('abort', () =>
        out.error(controller.signal.reason),
      )
    },
    pull(out) {
      if (stall) return new Promise<void>(() => {})
      const next = chunks.shift()
      if (next) out.enqueue(next)
      else out.close()
    },
  })
}

describe('idleGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes every chunk through and reports when the body ends', async () => {
    const controller = new AbortController()
    const onSettled = vi.fn()
    const body = idleGuard(
      sourceFrom(controller, [new Uint8Array([1]), new Uint8Array([2])]),
      controller,
      IDLE_MS,
      onSettled,
    )
    const bytes = new Uint8Array(await new Response(body).arrayBuffer())
    expect([...bytes]).toEqual([1, 2])
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(controller.signal.aborted).toBe(false)
  })

  it('aborts and errors with a timeout when storage stalls mid-read', async () => {
    const controller = new AbortController()
    const onSettled = vi.fn()
    const body = idleGuard(
      sourceFrom(controller, [], { stall: true }),
      controller,
      IDLE_MS,
      onSettled,
    )
    const reading = new Response(body).arrayBuffer()
    const outcome = reading.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(IDLE_MS)

    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StorageTimeoutError)
    expect(controller.signal.aborted).toBe(true)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('does not time out a consumer that is slow to read', async () => {
    const controller = new AbortController()
    const body = idleGuard(
      sourceFrom(controller, [new Uint8Array([7]), new Uint8Array([8])]),
      controller,
      IDLE_MS,
    )
    const reader = body.getReader()

    // The first chunk is read promptly, then the consumer pauses well past
    // the idle limit before asking for the next one.
    await reader.read()
    await vi.advanceTimersByTimeAsync(IDLE_MS * 5)
    expect(controller.signal.aborted).toBe(false)

    const second = await reader.read()
    expect(second.value).toEqual(new Uint8Array([8]))
    expect(controller.signal.aborted).toBe(false)
  })

  it('aborts the request when the consumer cancels', async () => {
    const controller = new AbortController()
    const onSettled = vi.fn()
    const body = idleGuard(
      sourceFrom(controller, [new Uint8Array([1]), new Uint8Array([2])]),
      controller,
      IDLE_MS,
      onSettled,
    )
    await body.getReader().cancel('client went away')
    expect(controller.signal.aborted).toBe(true)
    expect(onSettled).toHaveBeenCalled()
  })
})
