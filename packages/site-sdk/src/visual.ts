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
import type { OverlayHandle } from './visual-overlay.js'

/** The SDK version the bridge announces in `hello`. Matches the package version. */
export const SDK_VERSION = '0.11.0'

const PREFIX = 'areca:v1:'

/** Sequence and language of one update. `seq` only grows during one editing session. */
export type PreviewUpdateInfo = { seq: number; locale: string | null }

/** CMS → site. Asks the bridge to announce itself again. */
export type PingMessage = { type: 'areca:v1:ping' }

/**
 * Site → CMS. Announces the bridge, its SDK version, whether it reports markers and
 * the page it is on (`location.href`).
 */
export type HelloMessage = {
  type: 'areca:v1:hello'
  sdkVersion: string
  markers: boolean
  url: string
}

/** CMS → site. A preview result built from unsaved values. */
export type UpdateMessage = {
  type: 'areca:v1:update'
  seq: number
  result: PreviewResult
  locale: string | null
}

/**
 * Who owns a marked element when it is not the page's own entry: another entry
 * (by id) or a site content section (by key). `null` means the page's own entry.
 */
export type MarkerOwner = { entry: string } | { global: string }

/** One marked field on the page: `field('title')` or `field('name', { global: 'company' })`. */
export type Marker = { field: string; owner: MarkerOwner | null }

/** A marker the CMS can open, with the label the outline chip shows. */
export type MarkerTarget = Marker & { label: string }

/** An element's box in the preview page's viewport, in CSS pixels. */
export type MarkerRect = { x: number; y: number; width: number; height: number }

/** Site → CMS. The distinct markers on the page. Sent after render and when they change. */
export type MarkersMessage = { type: 'areca:v1:markers'; markers: Marker[] }

/** Site → CMS. A marked element was clicked in Select mode. */
export type SelectMessage = {
  type: 'areca:v1:select'
  field: string
  owner: MarkerOwner | null
  rect: MarkerRect
}

/** Site → CMS. The page changed its address without a reload (client-side navigation). */
export type NavigateMessage = { type: 'areca:v1:navigate'; url: string }

/** Site → CMS. Escape was pressed in the preview, so the CMS can leave full screen. */
export type EscapeMessage = { type: 'areca:v1:escape' }

/** CMS → site. Outline this marker (a field was focused in the CMS), or nothing. */
export type HighlightMessage = { type: 'areca:v1:highlight'; target: Marker | null }

/**
 * CMS → site. How the bridge behaves. `targets` lists the markers the CMS can open;
 * any other marker behaves as if unmarked. `select` false is Browse: the page works
 * normally. `showAreas` outlines every target faintly. `cursorHint` shows the label
 * next to the cursor (full screen). `color` is the outline colour (`#rrggbb`).
 */
export type ModeMessage = {
  type: 'areca:v1:mode'
  select: boolean
  showAreas: boolean
  cursorHint: boolean
  color: string
  targets: MarkerTarget[]
}

export type ArecaMessage =
  | PingMessage
  | HelloMessage
  | UpdateMessage
  | MarkersMessage
  | SelectMessage
  | NavigateMessage
  | EscapeMessage
  | HighlightMessage
  | ModeMessage

/** Longest field key, owner id or label the protocol accepts. */
export const MARKER_TEXT_MAX = 200
/** Most markers or targets in one message. */
export const MARKERS_MAX = 500
/** Longest URL in `hello` and `navigate`. */
export const URL_MAX = 4096

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

function isText(value: unknown, max = MARKER_TEXT_MAX): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isOwner(value: unknown): value is MarkerOwner | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  return keys[0] === 'entry' ? isText(value.entry) : keys[0] === 'global' && isText(value.global)
}

function isMarker(value: unknown): value is Marker {
  return isRecord(value) && isText(value.field) && isOwner(value.owner)
}

function isTarget(value: unknown): value is MarkerTarget {
  return isMarker(value) && isText((value as Loose).label)
}

function isRect(value: unknown): value is MarkerRect {
  return (
    isRecord(value) &&
    [value.x, value.y, value.width, value.height].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    )
  )
}

function isList<T>(value: unknown, item: (v: unknown) => v is T): value is T[] {
  return Array.isArray(value) && value.length <= MARKERS_MAX && value.every(item)
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
      return (
        typeof value.sdkVersion === 'string' &&
        typeof value.markers === 'boolean' &&
        isText(value.url, URL_MAX)
      )
    case 'areca:v1:update':
      return (
        typeof value.seq === 'number' &&
        Number.isInteger(value.seq) &&
        value.seq >= 0 &&
        (value.locale === null || typeof value.locale === 'string') &&
        isPreviewResult(value.result)
      )
    case 'areca:v1:markers':
      return isList(value.markers, isMarker)
    case 'areca:v1:select':
      return isText(value.field) && isOwner(value.owner) && isRect(value.rect)
    case 'areca:v1:navigate':
      return isText(value.url, URL_MAX)
    case 'areca:v1:escape':
      return true
    case 'areca:v1:highlight':
      return value.target === null || isMarker(value.target)
    case 'areca:v1:mode':
      return (
        typeof value.select === 'boolean' &&
        typeof value.showAreas === 'boolean' &&
        typeof value.cursorHint === 'boolean' &&
        typeof value.color === 'string' &&
        /^#[0-9a-fA-F]{6}$/.test(value.color) &&
        isList(value.targets, isTarget)
      )
    default:
      return false
  }
}

/** A stable string for a marker, equal on both sides: `|title`, `entry:abc|name`, `global:company|email`. */
export function markerKey(marker: Marker): string {
  const owner =
    marker.owner === null
      ? ''
      : 'entry' in marker.owner
        ? `entry:${marker.owner.entry}`
        : `global:${marker.owner.global}`
  return `${owner}|${marker.field}`
}

/** The attributes `field()` returns. Spread them on the element that shows the field. */
export type VisualFieldAttributes = {
  'data-areca-field': string
  'data-areca-entry'?: string
  'data-areca-global'?: string
}

/**
 * Marks an element as showing a field, so the visual editor can outline it and jump
 * to the field on click. Use the key as your site code sees it (camelCase, or
 * `$seo.title` for SEO). Without an owner the field belongs to the page's own entry;
 * pass `{ entry: id }` or `{ global: key }` for a referenced entry or a site content
 * section (header, footer). The attributes are inert outside the visual editor.
 *
 * @example
 * <h1 {...field('title')}>{article.title}</h1>
 * <p {...field('email', { global: 'company' })}>{company.email}</p>
 */
export function field(
  key: string,
  owner?: { entry: string } | { global: string },
): VisualFieldAttributes {
  if (!isText(key)) throw new TypeError(`field(): the key must be 1-${MARKER_TEXT_MAX} characters`)
  if (owner && 'entry' in owner) return { 'data-areca-field': key, 'data-areca-entry': owner.entry }
  if (owner && 'global' in owner) return { 'data-areca-field': key, 'data-areca-global': owner.global }
  return { 'data-areca-field': key }
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
  readonly location?: { readonly href: string }
  addEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void
  addEventListener(type: 'popstate' | 'hashchange', listener: () => void): void
  removeEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void
  removeEventListener(type: 'popstate' | 'hashchange', listener: () => void): void
}

export type VisualBridgeOptions = {
  /** The CMS origin, e.g. `https://cms.example.com`. Any path is ignored. */
  cmsOrigin: string
  /** Called with each update newer than the last one applied. */
  onUpdate: (result: PreviewResult, info: PreviewUpdateInfo) => void
  /** Defaults to `globalThis.window`. */
  window?: BridgeWindow
  /**
   * Whether to report markers and draw the click-to-edit overlay. Defaults to true. The
   * overlay only starts on the real page (not with a `window` option).
   */
  markers?: boolean
}

export type VisualBridge = {
  /** Stops listening. Later messages do nothing. */
  destroy(): void
  /** True once the CMS has sent a valid ping or update. */
  connected(): boolean
}

const inert: VisualBridge = { destroy() {}, connected: () => false }

/** How often the bridge checks the address for changes no event reports. */
const NAVIGATION_POLL_MS = 300

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

// A failed overlay chunk is reported once per page, not once per bridge.
let overlayLoadWarned = false

/**
 * Connects a site's preview page to the CMS. It answers `ping` with `hello`, announces
 * itself once when created, and passes each newer `update` to `onUpdate`. It reports
 * client-side navigations, and draws the marker overlay on the real page (see
 * `markers`). Does nothing when there is no window or the page is not framed.
 */
export function createVisualBridge(options: VisualBridgeOptions): VisualBridge {
  const cmsOrigin = normaliseOrigin(options.cmsOrigin)
  const win = options.window ?? (globalThis as { window?: BridgeWindow }).window
  if (win === undefined || win.parent === win.self) return inert
  const target: BridgeWindow = win
  const markers = options.markers ?? true

  let connected = false
  let lastSeq = -1
  let destroyed = false
  let overlay: OverlayHandle | null = null
  // What the CMS asked of the overlay before it loaded, applied once it starts.
  let lastMode: ModeMessage | null = null
  let lastHighlight: Marker | null = null

  function currentHref(): string {
    const href = target.location?.href
    return href && href.length <= URL_MAX ? href : 'about:blank'
  }

  function post(message: unknown) {
    target.parent.postMessage(message, cmsOrigin)
  }

  function hello(): HelloMessage {
    return { type: 'areca:v1:hello', sdkVersion: SDK_VERSION, markers, url: currentHref() }
  }

  let lastHref = currentHref()

  /** Reports the address once per change. Called by events, the poll and destroy. */
  function reportNavigation() {
    const href = currentHref()
    if (href === lastHref) return
    lastHref = href
    post({ type: 'areca:v1:navigate', url: href } satisfies NavigateMessage)
  }

  function onNavigation() {
    if (!destroyed) reportNavigation()
  }

  function onMessage(event: BridgeMessageEvent) {
    if (event.origin !== cmsOrigin || event.source !== target.parent) return
    if (!isArecaMessage(event.data)) return
    const message = event.data
    if (message.type === 'areca:v1:ping') {
      connected = true
      post(hello())
      // The CMS forgets markers when the frame reloads, so answer every ping with them.
      overlay?.resend()
    } else if (message.type === 'areca:v1:update') {
      connected = true
      if (message.seq <= lastSeq) return
      lastSeq = message.seq
      options.onUpdate(message.result, { seq: message.seq, locale: message.locale })
    } else if (message.type === 'areca:v1:mode') {
      lastMode = message
      overlay?.setMode(message)
    } else if (message.type === 'areca:v1:highlight') {
      lastHighlight = message.target
      overlay?.highlight(message.target)
    }
  }

  target.addEventListener('message', onMessage)
  target.addEventListener('popstate', onNavigation)
  target.addEventListener('hashchange', onNavigation)
  const poll = globalThis.setInterval(onNavigation, NAVIGATION_POLL_MS)
  post(hello())

  // The overlay draws on the real page only. A fake window (tests) never touches the DOM.
  // It loads on demand, so pages outside the CMS frame never download it, and starts
  // after hello, so its first markers message follows the announcement.
  if (markers && options.window === undefined && typeof document !== 'undefined') {
    void import('./visual-overlay.js').then(
      ({ startOverlay }) => {
        if (destroyed) return
        overlay = startOverlay({
          post: (message) => post(message),
          document,
          window: target as unknown as Window,
        })
        if (lastMode) overlay.setMode(lastMode)
        if (lastHighlight) overlay.highlight(lastHighlight)
      },
      (error: unknown) => {
        if (overlayLoadWarned) return
        overlayLoadWarned = true
        console.warn('Live preview: could not load the click-to-edit overlay.', error)
      },
    )
  }

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      globalThis.clearInterval(poll)
      // The page may unmount after its address changed (client-side routers), so report it last.
      reportNavigation()
      target.removeEventListener('message', onMessage)
      target.removeEventListener('popstate', onNavigation)
      target.removeEventListener('hashchange', onNavigation)
      overlay?.destroy()
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
