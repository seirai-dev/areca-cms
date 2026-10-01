import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createShutdownHandler,
  installShutdownHandlers,
  resetShutdownForTest,
} from './shutdown.ts'

describe('shutdown handler', () => {
  afterEach(() => {
    resetShutdownForTest()
    process.removeAllListeners('SIGTERM')
  })

  it('drains the worker once, then exits 0', async () => {
    const stop = vi.fn(async () => true)
    const exit = vi.fn()
    const handler = createShutdownHandler({ stop, exit })
    await handler('SIGTERM')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits non-zero when jobs are still running after the bounded drain', async () => {
    const exit = vi.fn()
    await createShutdownHandler({ stop: async () => false, exit })('SIGINT')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('still exits when stop throws', async () => {
    const exit = vi.fn()
    await createShutdownHandler({
      stop: async () => {
        throw new Error('x')
      },
      exit,
    })('SIGTERM')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('a second signal exits immediately while draining', async () => {
    let release!: (v: boolean) => void
    const stop = vi.fn(() => new Promise<boolean>((r) => (release = r)))
    const exit = vi.fn()
    const handler = createShutdownHandler({ stop, exit })
    const first = handler('SIGTERM')
    await handler('SIGTERM')
    expect(exit).toHaveBeenCalledWith(1)
    expect(stop).toHaveBeenCalledTimes(1)
    release(true)
    await first
  })

  it('registers process handlers only once (HMR re-import)', () => {
    const before = process.listenerCount('SIGTERM')
    const deps = { stop: async () => true, exit: vi.fn() }
    expect(installShutdownHandlers(deps)).toBe(true)
    expect(installShutdownHandlers(deps)).toBe(false)
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
  })
})
