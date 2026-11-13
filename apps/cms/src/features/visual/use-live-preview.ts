import * as React from 'react'

import type { EntryData } from '#/lib/types'

import {
  HANDSHAKE_TIMEOUT_MS,
  PING_INTERVAL_MS,
  RETRY_MS,
  channelReducer,
  initialChannel,
  sendDelay,
} from './live-channel'
import type { ChannelEvent, ChannelState, Tier } from './live-channel'
import { isSiteMessage, pingMessage, updateMessage } from './protocol'
import type {
  HighlightMessage,
  LivePreviewResult,
  ModeMessage,
  SiteMessage,
} from './protocol'

/** What the live channel previews: one entry, or one site content section. */
export type LiveTarget =
  | { kind: 'entry'; collection: string; entryId: string }
  | { kind: 'global'; global: string }

export type LivePreviewOptions = {
  /** The preview iframe. Messages go to its `contentWindow` only. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  /** The preview site's origin. Null when there is none; the channel is then off. */
  origin: string | null
  enabled: boolean
  siteId: string
  target: LiveTarget
  /** The unsaved entry data, including every content language. */
  data: EntryData
  /** The content language being edited, or null for single-language sites. */
  locale: string | null
  /** Every valid message from the frame (hello, markers, select, navigate). */
  onSiteMessage?: (message: SiteMessage) => void
}

export type LivePreviewChannel = {
  tier: Tier
  /** True while the last request has failed and no newer one has succeeded. */
  failed: boolean
  /** Call on every iframe `load`. The handshake starts again each time. */
  onFrameLoad: () => void
  /** Sends a mode or highlight message to the frame, at the preview origin only. */
  post: (message: ModeMessage | HighlightMessage) => void
}

/** The endpoint that builds a preview from unsaved values (see `live-preview.ts`). */
export const LIVE_PREVIEW_PATH = '/api/editor/live-preview'

/** The JSON body for `LIVE_PREVIEW_PATH`. Entries and globals never share keys. */
export function liveRequestBody({
  siteId,
  target,
  data,
  locale,
}: {
  siteId: string
  target: LiveTarget
  data: EntryData
  locale: string | null
}) {
  const id =
    target.kind === 'entry'
      ? { entryId: target.entryId, collection: target.collection }
      : { global: target.global }
  return { siteId, ...id, data, locale }
}

/**
 * The CMS side of the live channel (docs/design/visual-editor.md, Decisions 2-4).
 *
 * The state machine lives in `live-channel.ts`; this hook does the I/O. It pings
 * the frame until a valid hello arrives from its window and origin, then sends
 * each unsaved change (debounced) to the server and posts the result to the frame.
 * Responses are posted only when they are the newest, and nothing is posted to an
 * origin other than the preview's. Everything stops on unmount or when disabled.
 */
export function useLivePreviewChannel(
  options: LivePreviewOptions,
): LivePreviewChannel {
  const { iframeRef, origin, enabled } = options

  const [view, setView] = React.useState<ChannelState>(initialChannel)
  const machine = React.useRef<ChannelState>(initialChannel)

  // The latest inputs, read by the timers and requests when they fire.
  const latest = React.useRef(options)
  React.useEffect(() => {
    latest.current = options
  })

  const dispatch = React.useCallback((event: ChannelEvent) => {
    const prev = machine.current
    const next = channelReducer(prev, event)
    if (next !== prev) {
      machine.current = next
      setView(next)
    }
    return { prev, next }
  }, [])

  const timers = React.useRef<{
    ping: number | null
    handshake: number | null
    retry: number | null
  }>({ ping: null, handshake: null, retry: null })
  const controller = React.useRef<AbortController | null>(null)

  const stopHandshake = React.useCallback(() => {
    const t = timers.current
    if (t.ping !== null) window.clearInterval(t.ping)
    if (t.handshake !== null) window.clearTimeout(t.handshake)
    t.ping = null
    t.handshake = null
  }, [])

  /** Sends the newest value if the channel is live, nothing is in flight and the value changed. */
  const flush = React.useCallback(() => {
    const { prev, next } = dispatch({ type: 'send' })
    if (next === prev || next.inFlight === null) return
    const seq = next.inFlight
    const sent = latest.current
    const request = new AbortController()
    controller.current = request

    void (async () => {
      let result: LivePreviewResult | null = null
      try {
        const response = await fetch(LIVE_PREVIEW_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(liveRequestBody(sent)),
          signal: request.signal,
        })
        if (response.ok) result = (await response.json()) as LivePreviewResult
      } catch {
        // A network error is a failed request, unless we were stopped on purpose.
      }
      if (request.signal.aborted) return
      if (controller.current === request) controller.current = null

      const outcome = dispatch({ type: 'response', seq, ok: result !== null })
      const { prev: before, next: after } = outcome
      if (result !== null) {
        if (
          after.applied !== before.applied &&
          after.tier === 'live' &&
          sent.origin
        ) {
          const frame = iframeRef.current?.contentWindow
          frame?.postMessage(
            updateMessage(seq, result, sent.locale),
            sent.origin,
          )
        }
        const t = timers.current
        if (t.retry !== null) window.clearTimeout(t.retry)
        t.retry = null
        flush()
        return
      }
      // One automatic retry of the same value; later failures wait for a change.
      if (after.failures === 1) {
        timers.current.retry = window.setTimeout(() => {
          timers.current.retry = null
          flush()
        }, RETRY_MS)
      }
    })()
  }, [dispatch, iframeRef])

  // Each iframe load starts a new handshake: a reload or a slug change gives a new bridge.
  const onFrameLoad = React.useCallback(() => {
    if (!latest.current.enabled) return
    stopHandshake()
    dispatch({ type: 'frame-loaded' })
    const frame = iframeRef.current?.contentWindow
    const target = latest.current.origin
    if (!frame || !target) return

    const ping = () => frame.postMessage(pingMessage(), target)
    ping()
    timers.current.ping = window.setInterval(ping, PING_INTERVAL_MS)
    timers.current.handshake = window.setTimeout(() => {
      timers.current.handshake = null
      if (timers.current.ping !== null)
        window.clearInterval(timers.current.ping)
      timers.current.ping = null
      dispatch({ type: 'handshake-timeout' })
    }, HANDSHAKE_TIMEOUT_MS)
  }, [dispatch, iframeRef, stopHandshake])

  // Only the frame's own hello counts: right origin, right window, right shape.
  React.useEffect(() => {
    if (!enabled || !origin) return
    function onMessage(event: MessageEvent) {
      const frame = iframeRef.current
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        event.origin !== origin
      )
        return
      if (!isSiteMessage(event.data)) return
      if (event.data.type === 'areca:v1:hello') {
        stopHandshake()
        dispatch({ type: 'hello' })
        flush()
      }
      latest.current.onSiteMessage?.(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [enabled, origin, dispatch, flush, iframeRef, stopHandshake])

  // A changed value is sent after a pause in typing, and at least once a second
  // while typing goes on (see `sendDelay`).
  const { data, locale } = options
  const firstChangeAt = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!enabled) {
      firstChangeAt.current = null
      return
    }
    dispatch({ type: 'value-changed' })
    firstChangeAt.current ??= Date.now()
    const timer = window.setTimeout(
      () => {
        firstChangeAt.current = null
        flush()
      },
      sendDelay(Date.now(), firstChangeAt.current),
    )
    return () => window.clearTimeout(timer)
  }, [enabled, data, locale, dispatch, flush])

  // Switching off, changing the preview origin or unmounting stops everything.
  React.useEffect(() => {
    return () => {
      stopHandshake()
      const t = timers.current
      if (t.retry !== null) window.clearTimeout(t.retry)
      t.retry = null
      controller.current?.abort()
      controller.current = null
      machine.current = initialChannel
      setView(initialChannel)
    }
  }, [enabled, origin, stopHandshake])

  const post = React.useCallback(
    (message: ModeMessage | HighlightMessage) => {
      const target = latest.current.origin
      const frame = iframeRef.current?.contentWindow
      if (target && frame) frame.postMessage(message, target)
    },
    [iframeRef],
  )

  return {
    tier: view.tier,
    failed: view.failures > 0,
    onFrameLoad,
    post,
  }
}
