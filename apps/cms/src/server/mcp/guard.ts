import { ForbiddenError } from '#/server/content/errors'

import type { McpActor, McpCredential } from './keys'

/**
 * Who may call a tool. `owner` covers the owner and agency-admin roles; `agency`
 * covers only agency admins. `go-live` also needs the credential's allowGoLive flag.
 */
export type ToolAccess = 'everyone' | 'owner' | 'go-live' | 'agency'

export function canUseTool(actor: McpActor, access: ToolAccess): boolean {
  switch (access) {
    case 'everyone':
      return true
    case 'owner':
      return actor.role !== 'editor'
    case 'go-live':
      return actor.allowGoLive
    case 'agency':
      return actor.role === 'agency'
  }
}

/**
 * Names the credential the way the copy should: a personal key, or the
 * connection an app made when it signed in. Keeps OAuth callers from being
 * told about a "key" they never had.
 */
export function credentialPhrase(credential: McpCredential): string {
  return credential === 'oauth' ? 'this AI connection' : 'this key'
}

/** The sentence a caller gets when going live is refused, with the fix for its credential. */
export function goLiveDeniedMessage(credential: McpCredential): string {
  return credential === 'oauth'
    ? 'Going live wasn\'t allowed when this app was connected. Reconnect it from Connect AI and tick "Allow going live", or ask a site owner to press Go live in the CMS.'
    : 'Going live is not enabled for this key. Ask a site owner to press Go live in the CMS, or use a key created with "Allow going live".'
}

function deniedMessage(actor: McpActor, access: Exclude<ToolAccess, 'everyone'>): string {
  switch (access) {
    case 'owner':
      return 'Only site owners can use this tool. Ask a site owner to make this change, or leave the entry as a draft.'
    case 'go-live':
      return goLiveDeniedMessage(actor.credential)
    case 'agency':
      return 'Only agency admins can change the collection schema. Ask an agency admin, or change the content instead.'
  }
}

/** Throws a Forbidden error with an actionable message when the actor lacks `access`. */
export function requireAccess(
  actor: McpActor,
  access: ToolAccess,
  message?: string,
): void {
  if (canUseTool(actor, access)) return
  if (access === 'everyone') return
  throw new ForbiddenError(message ?? deniedMessage(actor, access))
}
