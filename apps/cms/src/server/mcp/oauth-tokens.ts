import { getOAuthProviderApi } from '@better-auth/oauth-provider'
import type { GenericEndpointContext } from 'better-auth'
import {
  createDpopReplayStore,
  DPOP_SIGNING_ALGORITHMS,
  enforceDpopBinding,
  isDpopBindingError,
  parseAccessTokenAuthorization,
} from 'better-auth/oauth2'

import { auth } from '#/lib/auth'

export type VerifiedMcpToken = {
  userId: string
  clientId: string
  /** The explicit approval generation this token belongs to. */
  connectionId: string
  /** RFC 8707 audiences the token was issued for. */
  resources: string[]
  scopes: string[]
}

export type McpTokenVerdict =
  | { ok: true; token: VerifiedMcpToken }
  | {
      ok: false
      error?: 'invalid_token' | 'invalid_dpop_proof'
      dpop?: boolean
    }

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
  request?: Request,
  resourceUrl?: string,
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
    const authorization = request
      ? parseAccessTokenAuthorization(request.headers.get('authorization'))
      : { scheme: 'Bearer' as const, token }
    if (
      !authorization ||
      authorization.scheme === 'Unknown' ||
      authorization.token !== token
    ) {
      return { ok: false }
    }
    // The maintained resource-server helper enforces scheme, proof signature,
    // htm/htu, access-token hash and cnf.jkt. Reservations are atomic in the
    // shared auth database, so replay protection survives process restarts.
    const replayStore = createDpopReplayStore(ctx.internalAdapter)
    await enforceDpopBinding({
      payload,
      authorization,
      proofJwt: request?.headers.get('dpop'),
      method: request?.method ?? 'GET',
      // APP_URL provides the public URL even when a proxy uses an internal URL.
      url: resourceUrl ?? request?.url ?? '',
      replayStore: {
        // Proof age checks include the final second; database timestamps are
        // precise, so retain the reservation through that entire second.
        reserve: (reservation) =>
          replayStore.reserve({
            ...reservation,
            expiresAt: new Date(reservation.expiresAt.getTime() + 1_000),
          }),
      },
      proofMaxAgeSeconds: 60,
      signingAlgorithms: DPOP_SIGNING_ALGORITHMS,
    })

    const userId = typeof payload.sub === 'string' ? payload.sub : null
    const clientId =
      typeof payload.client_id === 'string' ? payload.client_id : null
    const connectionId =
      typeof payload.mcp_connection_id === 'string'
        ? payload.mcp_connection_id
        : null
    if (!userId || !clientId || !connectionId) return { ok: false }

    const resources = toStringList(payload.aud)
    const scopes =
      typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter((value) => value.length > 0)
        : []
    return {
      ok: true,
      token: { userId, clientId, connectionId, resources, scopes },
    }
  } catch (error) {
    if (isDpopBindingError(error)) {
      return { ok: false, error: error.code, dpop: true }
    }
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
