/**
 * The CMS side of the visual editor's bridge protocol (docs/design/visual-editor.md,
 * "Bridge protocol"). The site side is `@areca-cms/site-sdk/visual`. The two copies
 * must agree: protocol.test.ts imports the SDK source and checks both directions.
 */

export const PROTOCOL_PREFIX = 'areca:v1:'

/** A preview result from `/api/editor/live-preview` (the `/api/sites/preview` shape). */
export type LivePreviewResult = Record<string, unknown>

/** CMS → site. Asks the bridge to announce itself again. */
export type PingMessage = { type: 'areca:v1:ping' }

/** CMS → site. A preview result built from unsaved values, with its sequence number. */
export type UpdateMessage = {
  type: 'areca:v1:update'
  seq: number
  result: LivePreviewResult
  locale: string | null
}

/** Site → CMS. The bridge is there; it answers a ping with this. `url` is the page it is on. */
export type HelloMessage = {
  type: 'areca:v1:hello'
  sdkVersion: string
  markers: boolean
  url: string
}

/** Another entry (by id) or a site content section (by key). Null: the page's own entry. */
export type MarkerOwner = { entry: string } | { global: string }

/** One marked field on the page, as the site wrote it (`field('heroImage')`). */
export type Marker = { field: string; owner: MarkerOwner | null }

/** A marker the CMS can open, with the label its outline chip shows. */
export type MarkerTarget = Marker & { label: string }

/** An element's box in the preview page's viewport, in CSS pixels. */
export type MarkerRect = { x: number; y: number; width: number; height: number }

/** Site → CMS. The distinct markers on the page, after render and when they change. */
export type MarkersMessage = { type: 'areca:v1:markers'; markers: Marker[] }

/** Site → CMS. A marked element was clicked in Select mode. */
export type SelectMessage = {
  type: 'areca:v1:select'
  field: string
  owner: MarkerOwner | null
  rect: MarkerRect
}

/** Site → CMS. The page changed address without a reload. */
export type NavigateMessage = { type: 'areca:v1:navigate'; url: string }

/** CMS → site. Outline this marker, or nothing. */
export type HighlightMessage = {
  type: 'areca:v1:highlight'
  target: Marker | null
}

/** CMS → site. Select or Browse, editable areas, cursor hint, colour and the openable markers. */
export type ModeMessage = {
  type: 'areca:v1:mode'
  select: boolean
  showAreas: boolean
  cursorHint: boolean
  color: string
  targets: MarkerTarget[]
}

/** Every message the site can send to the CMS in this protocol version. */
export type SiteMessage =
  HelloMessage | MarkersMessage | SelectMessage | NavigateMessage

export const MARKER_TEXT_MAX = 200
export const MARKERS_MAX = 500
export const URL_MAX = 4096

export function pingMessage(): PingMessage {
  return { type: 'areca:v1:ping' }
}

export function updateMessage(
  seq: number,
  result: LivePreviewResult,
  locale: string | null,
): UpdateMessage {
  return { type: 'areca:v1:update', seq, result, locale }
}

export function highlightMessage(target: Marker | null): HighlightMessage {
  return { type: 'areca:v1:highlight', target }
}

export function modeMessage(mode: Omit<ModeMessage, 'type'>): ModeMessage {
  return { type: 'areca:v1:mode', ...mode }
}

/** The same string the SDK's `markerKey` gives: `|title`, `entry:abc|name`, `global:company|email`. */
export function markerKey(marker: Marker): string {
  const owner =
    marker.owner === null
      ? ''
      : 'entry' in marker.owner
        ? `entry:${marker.owner.entry}`
        : `global:${marker.owner.global}`
  return `${owner}|${marker.field}`
}

/** `entry:abc` or `global:company`; '' for the page's own entry. */
export function ownerKey(owner: MarkerOwner | null): string {
  return markerKey({ field: '', owner }).slice(0, -1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, max = MARKER_TEXT_MAX): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isOwner(value: unknown): value is MarkerOwner | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  return keys[0] === 'entry'
    ? isText(value.entry)
    : keys[0] === 'global' && isText(value.global)
}

function isMarker(value: unknown): value is Marker {
  return isRecord(value) && isText(value.field) && isOwner(value.owner)
}

function isRect(value: unknown): value is MarkerRect {
  return (
    isRecord(value) &&
    [value.x, value.y, value.width, value.height].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    )
  )
}

/**
 * True for a site → CMS message this version defines, with every field the
 * right type. Anything else (other versions, unknown names, CMS-only messages)
 * is refused. The CMS also checks the origin and source before reading `data`.
 */
export function isSiteMessage(value: unknown): value is SiteMessage {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !value.type.startsWith(PROTOCOL_PREFIX)
  ) {
    return false
  }
  switch (value.type) {
    case 'areca:v1:hello':
      return (
        typeof value.sdkVersion === 'string' &&
        typeof value.markers === 'boolean' &&
        isText(value.url, URL_MAX)
      )
    case 'areca:v1:markers':
      return (
        Array.isArray(value.markers) &&
        value.markers.length <= MARKERS_MAX &&
        value.markers.every(isMarker)
      )
    case 'areca:v1:select':
      return isText(value.field) && isOwner(value.owner) && isRect(value.rect)
    case 'areca:v1:navigate':
      return isText(value.url, URL_MAX)
    default:
      return false
  }
}
