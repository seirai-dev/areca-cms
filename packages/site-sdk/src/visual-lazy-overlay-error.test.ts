import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVisualBridge } from './visual.js'

vi.mock('./visual-overlay.js', () => {
  throw new Error('chunk missing')
})

function framedPage() {
  const win: Record<string, unknown> = {
    location: { href: 'https://site.test/blog/alpha' },
    addEventListener() {},
    removeEventListener() {},
  }
  win.self = win
  win.parent = { postMessage: vi.fn() }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', {})
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('visual overlay load failure', () => {
  it('warns once and keeps the bridge working', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    framedPage()
    const first = createVisualBridge({ cmsOrigin: 'https://cms.test', onUpdate: () => {} })
    const second = createVisualBridge({ cmsOrigin: 'https://cms.test', onUpdate: () => {} })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe('Live preview: could not load the click-to-edit overlay.')
    expect(() => {
      first.destroy()
      second.destroy()
    }).not.toThrow()
  })
})
