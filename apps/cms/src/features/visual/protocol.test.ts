import { describe, expect, it } from 'vitest'

import {
  createVisualBridge,
  isArecaMessage as sdkIsArecaMessage,
} from '../../../../../packages/site-sdk/src/visual'
import type {
  BridgeMessageEvent,
  BridgeWindow,
} from '../../../../../packages/site-sdk/src/visual'
import { isSiteMessage, pingMessage, updateMessage } from './protocol'
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
    ['an unknown site message', { type: 'areca:v1:select', field: 'title' }],
  ])('rejects %s', (_name, value) => {
    expect(isSiteMessage(value)).toBe(false)
  })

  it('accepts a hello with markers true', () => {
    expect(
      isSiteMessage({
        type: 'areca:v1:hello',
        sdkVersion: '0.9.0',
        markers: true,
      }),
    ).toBe(true)
  })
})
