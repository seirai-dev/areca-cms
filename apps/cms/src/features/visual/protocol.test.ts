import { describe, expect, it } from 'vitest'

import {
  createVisualBridge,
  isArecaMessage as sdkIsArecaMessage,
  markerKey as sdkMarkerKey,
} from '../../../../../packages/site-sdk/src/visual'
import type {
  BridgeMessageEvent,
  BridgeWindow,
} from '../../../../../packages/site-sdk/src/visual'
import {
  highlightMessage,
  isSiteMessage,
  markerKey,
  modeMessage,
  ownerKey,
  pingMessage,
  updateMessage,
} from './protocol'
import type { LivePreviewResult } from './protocol'

// The CMS copy of the bridge protocol must agree with the SDK's. These tests
// import the SDK source itself, so a drift on either side fails here.

const CMS = 'https://cms.test'

const entryResult: LivePreviewResult = {
  kind: 'entry',
  collection: 'articles',
  slug: 'alpha',
  entry: {
    id: 'a1',
    slug: 'alpha',
    publishedAt: null,
    data: { title: 'Draft' },
  },
}

const globalResult: LivePreviewResult = {
  kind: 'global',
  global: 'company-info',
  entry: { id: 'g1', publishedAt: null, data: {} },
}

type Posted = { message: unknown; targetOrigin: string }

/** A framed window whose parent is the CMS. Mirrors packages/site-sdk/src/visual.test.ts. */
function framedWindow() {
  const listeners = new Set<(event: BridgeMessageEvent) => void>()
  const posted: Posted[] = []
  const parent = {
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, targetOrigin })
    },
  }
  const win: Record<string, unknown> = {
    addEventListener(
      type: string,
      listener: (event: BridgeMessageEvent) => void,
    ) {
      if (type === 'message') listeners.add(listener)
    },
    removeEventListener(
      type: string,
      listener: (event: BridgeMessageEvent) => void,
    ) {
      if (type === 'message') listeners.delete(listener)
    },
    parent,
  }
  win.self = win
  return {
    win: win as unknown as BridgeWindow,
    parent,
    posted,
    dispatch(event: Partial<BridgeMessageEvent>) {
      const full: BridgeMessageEvent = {
        origin: CMS,
        source: parent,
        data: undefined,
        ...event,
      }
      for (const listener of [...listeners]) listener(full)
    },
  }
}

describe('CMS messages pass the SDK guard', () => {
  it('ping', () => {
    expect(sdkIsArecaMessage(pingMessage())).toBe(true)
  })

  it.each([
    ['an entry result', 3, entryResult, null],
    ['an entry result with a locale', 4, entryResult, 'nl'],
    ['a global result', 0, globalResult, 'tr'],
  ])('update with %s', (_name, seq, result, locale) => {
    expect(sdkIsArecaMessage(updateMessage(seq, result, locale))).toBe(true)
  })

  it.each([
    ['a field', { field: 'title', owner: null }],
    ['an entry owner', { field: 'name', owner: { entry: 'a1' } }],
    ['a section owner', { field: 'email', owner: { global: 'company' } }],
    ['nothing', null],
  ] as const)('highlight with %s', (_name, target) => {
    expect(sdkIsArecaMessage(highlightMessage(target))).toBe(true)
  })

  it('mode with targets', () => {
    expect(
      sdkIsArecaMessage(
        modeMessage({
          select: true,
          showAreas: false,
          cursorHint: true,
          color: '#5b5bd6',
          targets: [
            { field: 'title', owner: null, label: 'Title' },
            { field: 'name', owner: { global: 'company' }, label: 'Company' },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('mode with a colour that is not #rrggbb is refused by the SDK', () => {
    expect(
      sdkIsArecaMessage(
        modeMessage({
          select: true,
          showAreas: false,
          cursorHint: false,
          color: 'red',
          targets: [],
        }),
      ),
    ).toBe(false)
  })

  it('markerKey is the same string on both sides', () => {
    for (const marker of [
      { field: 'title', owner: null },
      { field: 'name', owner: { entry: 'a1' } },
      { field: 'email', owner: { global: 'company' } },
    ]) {
      expect(markerKey(marker)).toBe(sdkMarkerKey(marker))
    }
    expect(ownerKey({ global: 'company' })).toBe('global:company')
    expect(ownerKey(null)).toBe('')
  })

  it('update carries the seq, result and locale it was built with', () => {
    expect(updateMessage(7, entryResult, 'nl')).toEqual({
      type: 'areca:v1:update',
      seq: 7,
      result: entryResult,
      locale: 'nl',
    })
  })
})

describe('SDK messages pass the CMS guard', () => {
  it('the hello the bridge sends when it is created', () => {
    const { win, posted } = framedWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })

    expect(posted).toHaveLength(1)
    expect(posted[0].targetOrigin).toBe(CMS)
    expect(isSiteMessage(posted[0].message)).toBe(true)
  })

  it('the hello the bridge replies with to a ping', () => {
    const { win, parent, posted, dispatch } = framedWindow()
    createVisualBridge({ cmsOrigin: CMS, onUpdate: () => {}, window: win })
    posted.length = 0

    dispatch({ data: pingMessage(), source: parent })

    expect(posted).toHaveLength(1)
    expect(isSiteMessage(posted[0].message)).toBe(true)
  })
})

describe('isSiteMessage', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'areca:v1:hello'],
    ['no type', { sdkVersion: '0.9.0', markers: false }],
    [
      'a type without the prefix',
      { type: 'hello', sdkVersion: '0.9.0', markers: false },
    ],
    [
      'another version',
      { type: 'areca:v2:hello', sdkVersion: '0.9.0', markers: false },
    ],
    ['hello without sdkVersion', { type: 'areca:v1:hello', markers: false }],
    [
      'hello with markers as a string',
      { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: 'no' },
    ],
    ['a CMS-only message (ping)', pingMessage()],
    ['a CMS-only message (update)', updateMessage(1, entryResult, null)],
    [
      'hello without url',
      { type: 'areca:v1:hello', sdkVersion: '0.9.0', markers: true },
    ],
    [
      'select without a rect',
      { type: 'areca:v1:select', field: 'title', owner: null },
    ],
    [
      'select with an owner that has two keys',
      {
        type: 'areca:v1:select',
        field: 'title',
        owner: { entry: 'a', global: 'b' },
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    ],
    [
      'markers with an empty field',
      { type: 'areca:v1:markers', markers: [{ field: '', owner: null }] },
    ],
    [
      'too many markers',
      {
        type: 'areca:v1:markers',
        markers: Array.from({ length: 501 }, (_, i) => ({
          field: `f${i}`,
          owner: null,
        })),
      },
    ],
    ['navigate without url', { type: 'areca:v1:navigate' }],
    [
      'a CMS-only message (mode)',
      modeMessage({
        select: true,
        showAreas: false,
        cursorHint: false,
        color: '#000000',
        targets: [],
      }),
    ],
    ['an unknown site message', { type: 'areca:v1:hover', field: 'title' }],
  ])('rejects %s', (_name, value) => {
    expect(isSiteMessage(value)).toBe(false)
  })

  it.each<[string, unknown]>([
    [
      'hello',
      {
        type: 'areca:v1:hello',
        sdkVersion: '0.9.0',
        markers: true,
        url: 'https://site.test/__preview/articles/a',
      },
    ],
    [
      'markers',
      {
        type: 'areca:v1:markers',
        markers: [
          { field: 'title', owner: null },
          { field: 'name', owner: { global: 'company' } },
        ],
      },
    ],
    [
      'select',
      {
        type: 'areca:v1:select',
        field: 'name',
        owner: { entry: 'a1' },
        rect: { x: 1, y: 2, width: 30, height: 40 },
      },
    ],
    [
      'navigate',
      { type: 'areca:v1:navigate', url: 'https://site.test/journal' },
    ],
  ])('accepts %s', (_name, value) => {
    expect(isSiteMessage(value)).toBe(true)
  })

  it('accepts every message the SDK guard accepts from a site', () => {
    const fromSite = [
      { type: 'areca:v1:markers', markers: [{ field: 'title', owner: null }] },
      { type: 'areca:v1:navigate', url: 'https://site.test/x' },
      {
        type: 'areca:v1:select',
        field: 'title',
        owner: null,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
    ]
    for (const message of fromSite) {
      expect(sdkIsArecaMessage(message)).toBe(true)
      expect(isSiteMessage(message)).toBe(true)
    }
  })
})
