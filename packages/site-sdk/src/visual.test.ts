import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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

/**
 * A window with an injectable parent. `framed: false` makes the parent the window
 * itself, as a top-level page sees it. Messages from the CMS come from `parent`.
 */
function fakeWindow(options: { framed?: boolean } = {}) {
  const listeners = new Set<(event: BridgeMessageEvent) => void>()
  const posted: Posted[] = []
  const parent = {
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, targetOrigin })
    },
  }
  const win: Record<string, unknown> = {
    addEventListener(type: string, listener: (event: BridgeMessageEvent) => void) {
      if (type === 'message') listeners.add(listener)
    },
    removeEventListener(type: string, listener: (event: BridgeMessageEvent) => void) {
      if (type === 'message') listeners.delete(listener)
    },
  }
  win.self = win
  win.parent = options.framed === false ? win : parent
  return {
    win: win as unknown as BridgeWindow,
    parent: win.parent,
    posted,
    listeners,
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
  }
}

describe('isArecaMessage', () => {
  const update = { type: 'areca:v1:update', seq: 3, result, locale: null }

  it.each([
    ['ping', { type: 'areca:v1:ping' }],
    ['hello', { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: false }],
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
    ['hello with markers as a string', { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: 'no' }],
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
  it('sends one unsolicited hello to the CMS origin when created', () => {
    const { win, posted } = fakeWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })

    expect(posted).toEqual([
      {
        message: { type: 'areca:v1:hello', sdkVersion: SDK_VERSION, markers: false },
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
        message: { type: 'areca:v1:hello', sdkVersion: SDK_VERSION, markers: false },
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
