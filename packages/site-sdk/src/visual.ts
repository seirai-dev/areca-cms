/**
 * The visual editor's live channel, for `@areca-cms/site-sdk/visual`.
 *
 * Framework-agnostic and browser-safe: it imports no node modules, so it can run in a
 * site's preview page. The CMS sends unsaved preview results over `postMessage`; the
 * bridge hands each new one to `onUpdate`, and the site renders it (see
 * `useLivePreview` in `@areca-cms/site-sdk/visual-react`, or call `content.previewFrom`
 * on the server).
 *
 * Origins are pinned both ways: the bridge only talks to the CMS origin, and it only
 * accepts messages from that origin sent by its parent window.
 */
import type { PreviewResult } from './types.js'

/** The SDK version the bridge announces in `hello`. Matches the package version. */
export const SDK_VERSION = '0.9.0'

const PREFIX = 'areca:v1:'

/** Sequence and language of one update. `seq` only grows during one editing session. */
export type PreviewUpdateInfo = { seq: number; locale: string | null }

/** CMS → site. Asks the bridge to announce itself again. */
export type PingMessage = { type: 'areca:v1:ping' }

/** Site → CMS. Announces the bridge, its SDK version and whether it reports markers. */
export type HelloMessage = { type: 'areca:v1:hello'; sdkVersion: string; markers: boolean }

/** CMS → site. A preview result built from unsaved values. */
export type UpdateMessage = {
  type: 'areca:v1:update'
  seq: number
  result: PreviewResult
  locale: string | null
}

export type ArecaMessage = PingMessage | HelloMessage | UpdateMessage

type Loose = Record<string, unknown>

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPreviewResult(value: unknown): value is PreviewResult {
  if (!isRecord(value) || !isRecord(value.entry)) return false
  if (value.kind === 'global') return typeof value.global === 'string'
  return (
    (value.kind === undefined || value.kind === 'entry') &&
    typeof value.collection === 'string' &&
    typeof value.slug === 'string'
  )
}

/** True for a message this protocol version defines, with every field the right type. */
export function isArecaMessage(value: unknown): value is ArecaMessage {
  if (!isRecord(value) || typeof value.type !== 'string' || !value.type.startsWith(PREFIX)) {
    return false
  }
  switch (value.type) {
    case 'areca:v1:ping':
      return true
    case 'areca:v1:hello':
      return typeof value.sdkVersion === 'string' && typeof value.markers === 'boolean'
    case 'areca:v1:update':
      return (
        typeof value.seq === 'number' &&
        Number.isInteger(value.seq) &&
        value.seq >= 0 &&
        (value.locale === null || typeof value.locale === 'string') &&
        isPreviewResult(value.result)
      )
    default:
      return false
  }
}

/** The part of `MessageEvent` the bridge reads. */
export interface BridgeMessageEvent {
  readonly origin: string
  readonly source: unknown
  readonly data: unknown
}

/** The part of `Window` the bridge uses. Tests pass fakes; the default is `globalThis.window`. */
export interface BridgeWindow {
  readonly self: unknown
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void }
  addEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void
}

export type VisualBridgeOptions = {
  /** The CMS origin, e.g. `https://cms.example.com`. Any path is ignored. */
  cmsOrigin: string
  /** Called with each update newer than the last one applied. */
  onUpdate: (result: PreviewResult, info: PreviewUpdateInfo) => void
  /** Defaults to `globalThis.window`. */
  window?: BridgeWindow
}

export type VisualBridge = {
  /** Stops listening. Later messages do nothing. */
  destroy(): void
  /** True once the CMS has sent a valid ping or update. */
  connected(): boolean
}

const inert: VisualBridge = { destroy() {}, connected: () => false }

/** `new URL(value).origin`, refusing values with no origin such as `file:` URLs. */
function normaliseOrigin(value: string): string {
  let origin: string
  try {
    origin = new URL(value).origin
  } catch {
    throw new TypeError(`Not a CMS URL: ${value}`)
  }
  if (origin === 'null') throw new TypeError(`Not a CMS URL: ${value}`)
  return origin
}

/**
 * Connects a site's preview page to the CMS. It answers `ping` with `hello`, announces
 * itself once when created, and passes each newer `update` to `onUpdate`. Does nothing
 * when there is no window or the page is not framed.
 */
export function createVisualBridge(options: VisualBridgeOptions): VisualBridge {
  const cmsOrigin = normaliseOrigin(options.cmsOrigin)
  const win = options.window ?? (globalThis as { window?: BridgeWindow }).window
  if (win === undefined || win.parent === win.self) return inert
  const target: BridgeWindow = win

  const hello: HelloMessage = { type: 'areca:v1:hello', sdkVersion: SDK_VERSION, markers: false }
  let connected = false
  let lastSeq = -1

  function onMessage(event: BridgeMessageEvent) {
    if (event.origin !== cmsOrigin || event.source !== target.parent) return
    if (!isArecaMessage(event.data)) return
    const message = event.data
    if (message.type === 'areca:v1:ping') {
      connected = true
      target.parent.postMessage(hello, cmsOrigin)
    } else if (message.type === 'areca:v1:update') {
      connected = true
      if (message.seq <= lastSeq) return
      lastSeq = message.seq
      options.onUpdate(message.result, { seq: message.seq, locale: message.locale })
    }
  }

  target.addEventListener('message', onMessage)
  target.parent.postMessage(hello, cmsOrigin)

  return {
    destroy() {
      target.removeEventListener('message', onMessage)
    },
    connected: () => connected,
  }
}

/**
 * Applies a value only if it is newer than the last one applied, so results that
 * finish out of order never show an older draft. Used by `useLivePreview`.
 */
export function createLatestResolver<T>(
  apply: (value: T, seq: number) => void,
): { accept(seq: number, value: T): void } {
  let applied = -Infinity
  return {
    accept(seq, value) {
      if (seq <= applied) return
      applied = seq
      apply(value, seq)
    },
  }
}

/**
 * The `Content-Security-Policy` header for the preview route, so the CMS can frame it.
 *
 * Send it on the preview route only, never on the whole site: it lets the listed
 * origins frame the page. Pass the CMS origin (or origins, for example a local CMS
 * during development). Throws for a value that is not a URL with an origin.
 *
 * @example
 * return new Response(html, { headers: { ...previewHeaders(), ...visualEditingHeaders({ cmsOrigin: env.CMS_URL }) } })
 */
export function visualEditingHeaders(options: { cmsOrigin: string | string[] }): {
  'Content-Security-Policy': string
} {
  const values = Array.isArray(options.cmsOrigin) ? options.cmsOrigin : [options.cmsOrigin]
  const origins = [...new Set(values.map(normaliseOrigin))]
  return { 'Content-Security-Policy': ["frame-ancestors 'self'", ...origins].join(' ') }
}
