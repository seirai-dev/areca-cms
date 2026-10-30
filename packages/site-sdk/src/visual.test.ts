import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLatestResolver,
  createVisualBridge,
  isArecaMessage,
  SDK_VERSION,
  visualEditingHeaders,
  type BridgeMessageEvent,
  type BridgeWindow,
} from './visual.js'
import type { PreviewResult } from './types.js'

const CMS = 'https://cms.test'

const result: PreviewResult = {
  collection: 'blog-posts',
  slug: 'alpha',
  entry: { id: 'p1', slug: 'alpha', publishedAt: null, data: { title: 'Draft' } } as never,
}

type Posted = { message: unknown; targetOrigin: string }

const PAGE = 'https://site.test/blog/alpha'

/**
 * A window with an injectable parent. `framed: false` makes the parent the window
 * itself, as a top-level page sees it. Messages from the CMS come from `parent`.
 * `navigate` changes the address and fires `popstate`, as a client-side router does.
 */
function fakeWindow(options: { framed?: boolean; href?: string | null } = {}) {
  const listeners = new Set<(event: BridgeMessageEvent) => void>()
  const navListeners = new Set<() => void>()
  const posted: Posted[] = []
  const parent = {
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, targetOrigin })
    },
  }
  const location: { href?: string } = {}
  if (options.href !== null) location.href = options.href ?? PAGE
  const win: Record<string, unknown> = {
    location,
    addEventListener(type: string, listener: (event: never) => void) {
      if (type === 'message') listeners.add(listener as (event: BridgeMessageEvent) => void)
      else if (type === 'popstate' || type === 'hashchange') navListeners.add(listener as () => void)
    },
    removeEventListener(type: string, listener: (event: never) => void) {
      if (type === 'message') listeners.delete(listener as (event: BridgeMessageEvent) => void)
      else navListeners.delete(listener as () => void)
    },
  }
  win.self = win
  win.parent = options.framed === false ? win : parent
  return {
    win: win as unknown as BridgeWindow,
    parent: win.parent,
    posted,
    listeners,
    navListeners,
    /** Delivers a message event to every listener, as the browser does. */
    dispatch(event: Partial<BridgeMessageEvent>) {
      const full: BridgeMessageEvent = {
        origin: CMS,
        source: win.parent,
        data: undefined,
        ...event,
      }
      for (const listener of [...listeners]) listener(full)
    },
    /** Changes the address and fires `popstate`, as a client-side router does. */
    navigate(href: string) {
      location.href = href
      for (const listener of [...navListeners]) listener()
    },
    /** Changes the address without firing any event, as a router that only polls would see it. */
    move(href: string) {
      location.href = href
    },
  }
}

const hello = (overrides: Record<string, unknown> = {}) => ({
  type: 'areca:v1:hello',
  sdkVersion: SDK_VERSION,
  markers: true,
  url: PAGE,
  ...overrides,
})

describe('isArecaMessage', () => {
  const update = { type: 'areca:v1:update', seq: 3, result, locale: null }

  it.each([
    ['ping', { type: 'areca:v1:ping' }],
    ['hello', { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: false, url: PAGE }],
    ['mode', { type: 'areca:v1:mode', select: true, showAreas: false, cursorHint: false, color: '#4f46e5', targets: [] }],
    ['mode with a target', { type: 'areca:v1:mode', select: false, showAreas: true, cursorHint: true, color: '#00aa00', targets: [{ field: 'title', owner: null, label: 'Title' }] }],
    ['highlight', { type: 'areca:v1:highlight', target: { field: 'name', owner: { entry: 'a1' } } }],
    ['highlight cleared', { type: 'areca:v1:highlight', target: null }],
    ['markers', { type: 'areca:v1:markers', markers: [{ field: 'title', owner: null }, { field: 'email', owner: { global: 'company' } }] }],
    ['select', { type: 'areca:v1:select', field: 'title', owner: null, rect: { x: 1, y: 2, width: 3, height: 4 } }],
    ['navigate', { type: 'areca:v1:navigate', url: PAGE }],
    ['escape', { type: 'areca:v1:escape' }],
    ['update', update],
    ['update with a locale', { ...update, locale: 'nl' }],
    ['update with a global result', { ...update, result: { kind: 'global', global: 'company-info', entry: { id: 'g', publishedAt: null, data: {} } } }],
  ])('accepts a valid %s message', (_name, value) => {
    expect(isArecaMessage(value)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'areca:v1:ping'],
    ['an array', [{ type: 'areca:v1:ping' }]],
    ['no type', {}],
    ['a type without the prefix', { type: 'ping' }],
    ['another version', { type: 'areca:v2:ping' }],
    ['an unknown name', { type: 'areca:v1:nope' }],
    ['hello without sdkVersion', { type: 'areca:v1:hello', markers: false }],
    ['hello with markers as a string', { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: 'no', url: PAGE }],
    ['hello without a url', { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: true }],
    ['mode with a bad colour', { type: 'areca:v1:mode', select: true, showAreas: false, cursorHint: false, color: 'red', targets: [] }],
    ['mode with a target without a label', { type: 'areca:v1:mode', select: true, showAreas: false, cursorHint: false, color: '#000000', targets: [{ field: 'title', owner: null }] }],
    ['highlight without a target', { type: 'areca:v1:highlight' }],
    ['markers with an empty field', { type: 'areca:v1:markers', markers: [{ field: '', owner: null }] }],
    ['select with a rect missing height', { type: 'areca:v1:select', field: 'title', owner: null, rect: { x: 1, y: 2, width: 3 } }],
    ['navigate without a url', { type: 'areca:v1:navigate' }],
    ['update with a string seq', { ...update, seq: '3' }],
    ['update with a negative seq', { ...update, seq: -1 }],
    ['update with a fractional seq', { ...update, seq: 1.5 }],
    ['update without a locale', { type: 'areca:v1:update', seq: 3, result }],
    ['update with a non-string locale', { ...update, locale: 7 }],
    ['update without a result', { type: 'areca:v1:update', seq: 3, locale: null }],
    ['update with a result of another kind', { ...update, result: { kind: 'page' } }],
    ['update with an entry result without a slug', { ...update, result: { collection: 'x', entry: {} } }],
    ['update with a global result without a global', { ...update, result: { kind: 'global', entry: {} } }],
  ])('rejects %s', (_name, value) => {
    expect(isArecaMessage(value)).toBe(false)
  })
})

describe('createVisualBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one unsolicited hello to the CMS origin when created', () => {
    const { win, posted } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })

    expect(posted).toEqual([
      {
        message: hello(),
        targetOrigin: CMS,
      },
    ])
  })

  it('normalises cmsOrigin to its origin, so a path does not change the target', () => {
    const { win, posted } = fakeWindow()
    createVisualBridge({ cmsOrigin: 'https://cms.test/admin/', onUpdate: () => {}, window: win })

    expect(posted[0]!.targetOrigin).toBe(CMS)
  })

  it('rejects a cmsOrigin that is not a URL', () => {
    const { win } = fakeWindow()
    expect(() =>
      createVisualBridge({ cmsOrigin: 'not a url', onUpdate: () => {}, window: win }),
    ).toThrow()
  })

  it('replies to ping with hello, targeted at the exact CMS origin and never *', () => {
    const { win, parent, posted, dispatch } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    dispatch({ data: { type: 'areca:v1:ping' }, source: parent })

    expect(posted).toEqual([
      {
        message: hello(),
        targetOrigin: CMS,
      },
    ])
    expect(posted.every((entry) => entry.targetOrigin !== '*')).toBe(true)
  })

  it('applies an update from the CMS and passes its seq and locale', () => {
    const { win, parent, dispatch } = fakeWindow()
    const calls: unknown[] = []
    createVisualBridge({
      cmsOrigin: CMS,
      onUpdate: (value, info) => calls.push([value, info]),
      window: win,
    })

    dispatch({ data: { type: 'areca:v1:update', seq: 1, result, locale: 'nl' }, source: parent })

    expect(calls).toEqual([[result, { seq: 1, locale: 'nl' }]])
  })

  it('drops an update whose seq is not newer than the last applied one', () => {
    const { win, parent, dispatch } = fakeWindow()
    const seqs: number[] = []
    createVisualBridge({
      cmsOrigin: CMS,
      onUpdate: (_value, info) => seqs.push(info.seq),
      window: win,
    })
    const update = (seq: number) =>
      dispatch({ data: { type: 'areca:v1:update', seq, result, locale: null }, source: parent })

    update(2)
    update(2)
    update(1)
    update(3)

    expect(seqs).toEqual([2, 3])
  })

  it('ignores messages from another origin', () => {
    const { win, parent, posted, dispatch } = fakeWindow()
    const calls: unknown[] = []
    createVisualBridge({ cmsOrigin: CMS, onUpdate: (...args) => calls.push(args), window: win })
    posted.length = 0

    dispatch({ origin: 'https://evil.test', source: parent, data: { type: 'areca:v1:ping' } })
    dispatch({
      origin: 'https://evil.test',
      source: parent,
      data: { type: 'areca:v1:update', seq: 1, result, locale: null },
    })

    expect(posted).toEqual([])
    expect(calls).toEqual([])
  })

  it('ignores messages whose source is not the parent window', () => {
    const { win, posted, dispatch } = fakeWindow()
    const calls: unknown[] = []
    createVisualBridge({ cmsOrigin: CMS, onUpdate: (...args) => calls.push(args), window: win })
    posted.length = 0

    dispatch({ source: { postMessage() {} }, data: { type: 'areca:v1:ping' } })
    dispatch({
      source: {},
      data: { type: 'areca:v1:update', seq: 1, result, locale: null },
    })

    expect(posted).toEqual([])
    expect(calls).toEqual([])
  })

  it('ignores payloads that fail the guard', () => {
    const { win, parent, posted, dispatch } = fakeWindow()
    const calls: unknown[] = []
    createVisualBridge({ cmsOrigin: CMS, onUpdate: (...args) => calls.push(args), window: win })
    posted.length = 0

    dispatch({ source: parent, data: { type: 'areca:v1:update', seq: '1', result, locale: null } })
    dispatch({ source: parent, data: 'areca:v1:ping' })
    dispatch({ source: parent, data: null })

    expect(posted).toEqual([])
    expect(calls).toEqual([])
  })

  it('ignores hello messages sent to the site', () => {
    const { win, parent, posted, dispatch } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    dispatch({ source: parent, data: { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: false } })

    expect(posted).toEqual([])
  })

  it('reports connected() once the CMS has sent a valid message', () => {
    const { win, parent, dispatch } = fakeWindow()
    const bridge = createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    expect(bridge.connected()).toBe(false)

    dispatch({ source: parent, data: { type: 'areca:v1:ping' } })

    expect(bridge.connected()).toBe(true)
  })

  it('removes its listener on destroy, so later messages do nothing', () => {
    const { win, parent, posted, listeners, dispatch } = fakeWindow()
    const calls: unknown[] = []
    const bridge = createVisualBridge({ cmsOrigin: CMS, onUpdate: (...args) => calls.push(args), window: win })
    expect(listeners.size).toBe(1)
    posted.length = 0

    bridge.destroy()
    dispatch({ source: parent, data: { type: 'areca:v1:ping' } })
    dispatch({ source: parent, data: { type: 'areca:v1:update', seq: 1, result, locale: null } })

    expect(listeners.size).toBe(0)
    expect(posted).toEqual([])
    expect(calls).toEqual([])
  })

  it('says whether it reports markers, true by default and false when the option is off', () => {
    const first = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: first.win })
    const second = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: second.win, markers: false })

    expect((first.posted[0]!.message as { markers: boolean }).markers).toBe(true)
    expect((second.posted[0]!.message as { markers: boolean }).markers).toBe(false)
  })

  it('announces the page address in hello', () => {
    const { win, posted } = fakeWindow({ href: 'https://site.test/blog/beta?x=1' })
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })

    expect((posted[0]!.message as { url: string }).url).toBe('https://site.test/blog/beta?x=1')
  })

  it('falls back to about:blank when the page has no address', () => {
    const { win, posted } = fakeWindow({ href: null })
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })

    expect((posted[0]!.message as { url: string }).url).toBe('about:blank')
  })

  it('reports a client-side navigation on popstate, and on hashchange', () => {
    const { win, posted, navigate } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    navigate('https://site.test/blog/beta')
    navigate('https://site.test/blog/beta#comments')

    expect(posted).toEqual([
      { message: { type: 'areca:v1:navigate', url: 'https://site.test/blog/beta' }, targetOrigin: CMS },
      { message: { type: 'areca:v1:navigate', url: 'https://site.test/blog/beta#comments' }, targetOrigin: CMS },
    ])
  })

  it('does not report a navigation to the address it already reported', () => {
    const { win, posted, navigate } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    navigate(PAGE)

    expect(posted).toEqual([])
  })

  it('polls the address every 300 ms, so a router that never fires an event is still seen', () => {
    const { win, posted, move } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    move('https://site.test/blog/gamma')
    vi.advanceTimersByTime(299)
    expect(posted).toEqual([])
    vi.advanceTimersByTime(1)

    expect(posted).toEqual([
      { message: { type: 'areca:v1:navigate', url: 'https://site.test/blog/gamma' }, targetOrigin: CMS },
    ])
  })

  it('reports a navigation once when the poll and an event both see it', () => {
    const { win, posted, navigate } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    navigate('https://site.test/blog/delta')
    vi.advanceTimersByTime(900)

    expect(posted).toHaveLength(1)
  })

  it('reports a navigation that happened before destroy, once, when destroy runs', () => {
    const { win, posted, move } = fakeWindow()
    const bridge = createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    move('https://site.test/blog/epsilon')
    bridge.destroy()
    bridge.destroy()

    expect(posted).toEqual([
      { message: { type: 'areca:v1:navigate', url: 'https://site.test/blog/epsilon' }, targetOrigin: CMS },
    ])
  })

  it('stops polling and listening on destroy', () => {
    const { win, posted, navListeners, move } = fakeWindow()
    const bridge = createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    bridge.destroy()
    posted.length = 0

    move('https://site.test/blog/zeta')
    vi.advanceTimersByTime(1000)

    expect(navListeners.size).toBe(0)
    expect(posted).toEqual([])
  })

  it('accepts mode and highlight messages without a page to draw on, and posts nothing', () => {
    const { win, parent, posted, dispatch } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    dispatch({
      source: parent,
      data: { type: 'areca:v1:mode', select: true, showAreas: false, cursorHint: false, color: '#4f46e5', targets: [] },
    })
    dispatch({ source: parent, data: { type: 'areca:v1:highlight', target: null } })

    expect(posted).toEqual([])
  })

  it('does nothing when the page is not framed', () => {
    const { win, posted, listeners } = fakeWindow({ framed: false })
    const calls: unknown[] = []
    const bridge = createVisualBridge({ cmsOrigin: CMS, onUpdate: (...args) => calls.push(args), window: win })

    expect(listeners.size).toBe(0)
    expect(posted).toEqual([])
    expect(bridge.connected()).toBe(false)
    expect(() => bridge.destroy()).not.toThrow()
    expect(calls).toEqual([])
  })

  it('does nothing without a window, as in node', () => {
    const bridge = createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {} })

    expect(bridge.connected()).toBe(false)
    expect(() => bridge.destroy()).not.toThrow()
  })
})

describe('createLatestResolver', () => {
  it('applies values in order', () => {
    const applied: string[] = []
    const latest = createLatestResolver<string>((value) => applied.push(value))

    latest.accept(1, 'a')
    latest.accept(2, 'b')

    expect(applied).toEqual(['a', 'b'])
  })

  it('keeps only the newest value when resolutions finish out of order', () => {
    const applied: string[] = []
    const latest = createLatestResolver<string>((value) => applied.push(value))

    latest.accept(2, 'b')
    latest.accept(1, 'a')

    expect(applied).toEqual(['b'])
  })

  it('ignores a repeated seq', () => {
    const applied: string[] = []
    const latest = createLatestResolver<string>((value) => applied.push(value))

    latest.accept(4, 'first')
    latest.accept(4, 'second')

    expect(applied).toEqual(['first'])
  })
})

describe('visualEditingHeaders', () => {
  it('allows framing by the CMS origin only, besides self', () => {
    expect(visualEditingHeaders({ cmsOrigin: 'https://cms.test/admin' })).toEqual({
      'Content-Security-Policy': "frame-ancestors 'self' https://cms.test",
    })
  })

  it('lists every origin once, normalised, in order', () => {
    expect(
      visualEditingHeaders({
        cmsOrigin: ['https://cms.test/', 'http://localhost:5173/x', 'https://cms.test'],
      }),
    ).toEqual({
      'Content-Security-Policy': "frame-ancestors 'self' https://cms.test http://localhost:5173",
    })
  })

  it('throws for an invalid URL', () => {
    expect(() => visualEditingHeaders({ cmsOrigin: 'cms.test' })).toThrow(/cms\.test/)
  })

  it('throws for an origin that has none, such as a file URL', () => {
    expect(() => visualEditingHeaders({ cmsOrigin: 'file:///tmp/cms' })).toThrow()
  })
})

describe('protocol module', () => {
  it('stays browser-safe: no node imports', () => {
    const source = readFileSync(fileURLToPath(new URL('./visual.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/from ['"]node:/)
    expect(source).not.toMatch(/from ['"]\.\/content\.js['"]/)
  })

  it('reports the package version', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    expect(SDK_VERSION).toBe(pkg.version)
  })
})
