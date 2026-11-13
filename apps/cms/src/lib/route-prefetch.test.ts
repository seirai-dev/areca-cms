import { afterEach, describe, expect, it, vi } from 'vitest'

import { awaitOnServer, prefetchInBrowser } from './route-prefetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('route prefetch', () => {
  it('waits on the server and only there', async () => {
    let done = false
    const start = () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          done = true
          resolve()
        }, 5),
      )
    await awaitOnServer(start)
    expect(done).toBe(true)

    vi.stubGlobal('window', globalThis)
    done = false
    expect(awaitOnServer(start)).toBeUndefined()
    expect(done).toBe(false)
  })

  it('starts browser-only queries in the browser only', () => {
    const start = vi.fn()
    prefetchInBrowser(start)
    expect(start).not.toHaveBeenCalled()
    vi.stubGlobal('window', globalThis)
    prefetchInBrowser(start)
    expect(start).toHaveBeenCalledTimes(1)
  })
})
