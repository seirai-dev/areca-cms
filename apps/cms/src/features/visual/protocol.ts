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

/** Site → CMS. The bridge is there; it answers a ping with this. */
export type HelloMessage = {
  type: 'areca:v1:hello'
  sdkVersion: string
  markers: boolean
}

/** Every message the site can send to the CMS in this protocol version. */
export type SiteMessage = HelloMessage

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
        typeof value.markers === 'boolean'
      )
    default:
      return false
  }
}
