import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVisualBridge, type BridgeMessageEvent } from './visual.js'

const overlay = vi.hoisted(() => ({
  setMode: vi.fn(),
  highlight: vi.fn(),
  resend: vi.fn(),
  destroy: vi.fn(),
}))
const startOverlay = vi.hoisted(() => vi.fn(() => overlay))
vi.mock('./visual-overlay.js', () => ({ startOverlay }))

const CMS = 'https://cms.test'

/** A page in a frame, installed as the global window, with a stand-in document. */
function framedPage({ framed = true } = {}) {
  const listeners = new Set<(event: BridgeMessageEvent) => void>()
  const parent = { postMessage: vi.fn() }
  const win: Record<string, unknown> = {
    location: { href: 'https://site.test/blog/alpha' },
    addEventListener(type: string, listener: (event: BridgeMessageEvent) => void) {
      if (type === 'message') listeners.add(listener)
    },
    removeEventListener(type: string, listener: (event: BridgeMessageEvent) => void) {
      listeners.delete(listener)
    },
  }
  win.self = win
  win.parent = framed ? parent : win
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', {})
  return {
    send(data: unknown) {
      for (const listener of [...listeners]) listener({ origin: CMS, source: win.parent, data })
    },
  }
}

const mode = {
  type: 'areca:v1:mode',
  select: true,
  showAreas: false,
  cursorHint: false,
  color: '#5856d6',
  targets: [{ field: 'title', owner: null, label: 'Title' }],
}
const target = { field: 'title', owner: null }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('visual overlay loading', () => {
  it('loads the overlay inside the CMS frame and replays what arrived before it', async () => {
    const page = framedPage()
    const bridge = createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {} })
    page.send(mode)
    page.send({ type: 'areca:v1:highlight', target })
    expect(startOverlay).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(startOverlay).toHaveBeenCalledTimes(1))
    expect(overlay.setMode).toHaveBeenCalledWith(mode)
    expect(overlay.highlight).toHaveBeenCalledWith(target)

    page.send({ type: 'areca:v1:highlight', target: null })
    expect(overlay.highlight).toHaveBeenLastCalledWith(null)
    bridge.destroy()
    expect(overlay.destroy).toHaveBeenCalled()
  })

  it('never starts the overlay after the bridge is destroyed', async () => {
    framedPage()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {} }).destroy()
    await import('./visual-overlay.js')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(startOverlay).not.toHaveBeenCalled()
  })

  it('does not load the overlay outside a frame', async () => {
    framedPage({ framed: false })
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(startOverlay).not.toHaveBeenCalled()
  })
})
