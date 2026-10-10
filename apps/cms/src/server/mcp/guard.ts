import { ForbiddenError } from '#/server/content/errors'

import type { McpActor } from './keys'

/**
 * Who may call a tool. `owner` covers the owner and agency-admin roles; `agency`
 * covers only agency admins. `go-live` also needs the key's allowGoLive flag.
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

const DEFAULT_DENIED: Record<Exclude<ToolAccess, 'everyone'>, string> = {
  owner:
    'Only site owners can use this tool. Ask a site owner to make this change, or leave the entry as a draft.',
  'go-live':
    'Going live is not enabled for this key. Ask a site owner to press Go live in the CMS, or use a key created with "Allow going live".',
  agency:
    'Only agency admins can change the collection schema. Ask an agency admin, or change the content instead.',
}

/** Throws a Forbidden error with an actionable message when the actor lacks `access`. */
export function requireAccess(
  actor: McpActor,
  access: ToolAccess,
  message?: string,
): void {
  if (canUseTool(actor, access)) return
  if (access === 'everyone') return
  throw new ForbiddenError(message ?? DEFAULT_DENIED[access])
}
