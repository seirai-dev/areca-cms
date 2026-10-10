import { getOAuthProviderApi } from '@better-auth/oauth-provider'
import type { GenericEndpointContext } from 'better-auth'

import { auth } from '#/lib/auth'

export type VerifiedMcpToken = {
  userId: string
  clientId: string
  /** RFC 8707 audiences the token was issued for. */
  resources: string[]
  scopes: string[]
}

export type McpTokenVerdict =
  | { ok: true; token: VerifiedMcpToken }
  | { ok: false }

/**
 * Verifies an OAuth access token issued by the authorization server: it must
 * exist, be unexpired, unrevoked and for an enabled client. Audience and
 * scope are checked by the caller against the site being requested.
 *
 * Uses the plugin's own validation, so the rules match the token endpoint.
 * Never throws; anything unexpected counts as an invalid token.
 */
export async function verifyMcpAccessToken(
  token: string,
): Promise<McpTokenVerdict> {
  try {
    const ctx = await auth.$context
    const plugin = ctx.getPlugin('oauth-provider')
    if (!plugin) return { ok: false }
    const provider = getOAuthProviderApi(
      { context: ctx } as unknown as GenericEndpointContext,
      plugin.options,
    )
    const payload = await provider.requireActiveAccessToken(token)

    const userId = typeof payload.sub === 'string' ? payload.sub : null
    const clientId =
      typeof payload.client_id === 'string' ? payload.client_id : null
    if (!userId || !clientId) return { ok: false }

    const resources = toStringList(payload.aud)
    const scopes =
      typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter((value) => value.length > 0)
        : []
    return { ok: true, token: { userId, clientId, resources, scopes } }
  } catch {
    return { ok: false }
  }
}

function toStringList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string')
  }
  return []
}
