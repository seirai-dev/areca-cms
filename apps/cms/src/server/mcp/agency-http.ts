/* eslint-disable @typescript-eslint/no-unnecessary-condition -- row lookups after .select() are checked defensively */
import { createMcpHandler } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import { parseAccessTokenAuthorization } from 'better-auth/oauth2'

import { db } from '#/db'
import { user } from '#/db/schema'

import { createArecaAgencyMcpServer } from './agency-server'
import { findUsableAgencyConnection, touchConnection } from './connections'
import type { AgencyPrincipal } from './keys'
import {
  MCP_KEY_PREFIX,
  agencyAdminStatus,
  resolveAgencyPrincipal,
} from './keys'
import { MCP_SCOPE, agencyMcpResourceUrl } from './oauth-resource'
import { verifyMcpAccessToken } from './oauth-tokens'
import {
  MCP_TRANSPORT_OPTIONS,
  challengeHeaderAt,
  isSuccessfulMcpResponse,
  mfaRequired,
  protectedResourceMetadataUrlFor,
  unknownSite,
} from './http'
import type { ChallengeParams } from './http'

const handler = createMcpHandler(
  (ctx: McpRequestContext) => createArecaAgencyMcpServer(principalFrom(ctx)),
  MCP_TRANSPORT_OPTIONS,
)

/** The principal travels in authInfo.extra, set per request after authentication. */
function principalFrom(ctx: McpRequestContext): AgencyPrincipal {
  const principal = ctx.authInfo?.extra?.principal
  if (!isPrincipal(principal)) {
    throw new Error(
      'Agency MCP request reached the server without an authenticated principal',
    )
  }
  return principal
}

function isPrincipal(value: unknown): value is AgencyPrincipal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'scope' in value &&
    value.scope === 'agency' &&
    'keyId' in value &&
    'user' in value
  )
}

/**
 * The RFC 6750 / RFC 9728 401 for the agency address. It names the agency
 * resource's metadata, so a client without a token finds how to sign in.
 */
function challenge401(
  params: ChallengeParams & { message?: string } = {},
): Response {
  const { message, ...challenge } = params
  return Response.json(
    {
      error:
        message ?? challenge.description ?? 'Sign in to connect to the agency',
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': challengeHeaderAt(agencyMetadataUrl(), challenge),
      },
    },
  )
}

function agencyMetadataUrl(): string {
  return protectedResourceMetadataUrlFor(agencyMcpResourceUrl())
}

function wrongScope(): Response {
  return challenge401({
    error: 'invalid_token',
    message:
      'This key is for one site. Use that site’s connector address, or create an agency key.',
  })
}

function insufficientScope(dpop: boolean): Response {
  return Response.json(
    { error: 'This connection is not allowed to use the agency connector' },
    {
      status: 403,
      headers: {
        'WWW-Authenticate': challengeHeaderAt(agencyMetadataUrl(), {
          error: 'insufficient_scope',
          scope: MCP_SCOPE,
          dpop,
        }),
      },
    },
  )
}

/**
 * The agency connector endpoint `/api/agency/mcp`. Two credentials work, and
 * both need an agency admin with MFA, read live on every request:
 *   - a personal agency key (`areca_mcp_…` with scope `agency`);
 *   - an OAuth access token issued for the agency resource, from an app the
 *     admin connected to every client (docs/design/agency-mcp.md).
 *
 * Anyone who is not an agency admin gets the same 404 an unknown site gets
 * (`{"error":"Site not found"}`), as the dev env rule does on the site
 * connector (docs/design/dev-environments.md, Decision 3). Missing or unknown
 * credentials get the 401 challenge.
 */
export async function handleAgencyMcpRequest(
  request: Request,
): Promise<Response> {
  const authorization = parseAccessTokenAuthorization(
    request.headers.get('authorization'),
  )
  const token =
    authorization?.scheme === 'Bearer' || authorization?.scheme === 'DPoP'
      ? authorization.token
      : null
  if (!token) return challenge401()

  if (token.startsWith(MCP_KEY_PREFIX)) {
    return agencyKeyRequest(request, token)
  }
  return agencyOAuthRequest(request, token, authorization?.scheme === 'DPoP')
}

async function agencyKeyRequest(
  request: Request,
  token: string,
): Promise<Response> {
  const resolution = await resolveAgencyPrincipal(token)
  if (!resolution.ok) {
    switch (resolution.reason) {
      case 'not_agency':
        return unknownSite()
      case 'mfa_required':
        return mfaRequired()
      case 'wrong_scope':
        return wrongScope()
      case 'invalid':
        return challenge401({
          error: 'invalid_token',
          message: 'Invalid or expired Areca MCP key',
        })
    }
  }
  return handler.fetch(request, {
    authInfo: {
      // Never the secret: the key id is enough for logs and audit.
      token: resolution.principal.keyId,
      clientId: resolution.principal.keyId,
      scopes: [],
      extra: { principal: resolution.principal },
    },
  })
}

async function agencyOAuthRequest(
  request: Request,
  token: string,
  dpop: boolean,
): Promise<Response> {
  if (token.startsWith(MCP_KEY_PREFIX)) {
    return challenge401({
      error: 'invalid_token',
      dpop: true,
      description: 'Personal keys require Bearer authorization',
    })
  }
  const verdict = await verifyMcpAccessToken(
    token,
    request,
    agencyMcpResourceUrl(),
  )
  if (!verdict.ok) {
    return challenge401({
      error: verdict.error ?? 'invalid_token',
      dpop: verdict.dpop || dpop,
      description:
        verdict.error === 'invalid_dpop_proof'
          ? 'DPoP proof is missing, invalid or already used'
          : 'Access token is invalid or expired',
    })
  }
  const { userId, clientId, connectionId, resources, scopes } = verdict.token

  const [owner] = await db
    .select({
      id: user.id,
      name: user.name,
      isAgencyAdmin: user.isAgencyAdmin,
      twoFactorEnabled: user.twoFactorEnabled,
      blockedAt: user.blockedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!owner) return challenge401({ error: 'invalid_token', dpop })

  // The live rules come first: a caller who is no longer an agency admin gets
  // the same answer as an unknown address, whatever token they hold.
  const status = agencyAdminStatus(owner)
  if (status === 'not_admin') return unknownSite()
  if (status === 'mfa_required') return mfaRequired()
  if (status === 'blocked') {
    return challenge401({
      error: 'invalid_token',
      dpop,
      description: 'You no longer have access to the agency connector',
    })
  }

  // RFC 8707: a token only works at the resource it was issued for. A site
  // token on the agency address is refused like any invalid token.
  if (!resources.includes(agencyMcpResourceUrl())) {
    return challenge401({
      error: 'invalid_token',
      dpop,
      description: 'Access token was issued for a different resource',
    })
  }
  if (!scopes.includes(MCP_SCOPE)) return insufficientScope(dpop)

  const connection = await findUsableAgencyConnection({ userId, clientId })
  if (!connection || connection.id !== connectionId) {
    return challenge401({
      error: 'invalid_token',
      dpop,
      description: 'This app is no longer connected to the agency',
    })
  }

  const principal: AgencyPrincipal = {
    scope: 'agency',
    role: 'agency',
    keyId: connection.id,
    keyName: connection.clientName,
    credential: 'oauth',
    userId: owner.id,
    userName: owner.name,
    user: { id: owner.id, isAgencyAdmin: true, blockedAt: owner.blockedAt },
  }
  const response = await handler.fetch(request, {
    authInfo: {
      // Never the secret: the connection id is enough for logs and audit.
      token: connection.id,
      clientId,
      scopes,
      extra: { principal },
    },
  })
  if (await isSuccessfulMcpResponse(response)) await touchConnection(connection)
  return response
}
