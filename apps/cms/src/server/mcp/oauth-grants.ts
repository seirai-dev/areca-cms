/* eslint-disable @typescript-eslint/no-unnecessary-condition -- database lookups are checked defensively */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import type { GenericEndpointContext } from 'better-auth'
import { getOAuthProviderApi } from '@better-auth/oauth-provider'
import {
  createDpopReplayStore,
  getConfirmationJkt,
  verifyDpopProof,
} from 'better-auth/oauth2'
import type { drizzleAdapter } from 'better-auth/adapters/drizzle'

import { db } from '#/db'
import { mcpConnection, oauthRefreshToken, verification } from '#/db/schema'
import {
  OAuthTokenBodyTooLarge,
  readOAuthTokenBody,
} from '#/server/http/oauth-token-body'

import {
  findUsableAgencyConnection,
  findUsableConnection,
  isConnectionUsable,
  revokeReplayedGrant,
  withConnectionLock,
} from './connections'
import {
  MCP_REFRESH_TOKEN_PREFIX,
  mcpResourceTarget,
  resourceParams,
  siteIdForAuthorizationQuery,
} from './oauth-resource'

// Only the server-side approval handler can reserve a new grant generation.
const approvalReference = new AsyncLocalStorage<string>()
export const withApprovalReference = <T>(id: string, run: () => Promise<T>) =>
  approvalReference.run(id, run)

/**
 * Consent reference for an agency approval that has no usable connection yet.
 * It is never a connection id, so the plugin asks for consent again (the same
 * job the site id does for site requests).
 */
export const AGENCY_PENDING_REFERENCE = 'agency:pending'

export async function consentReferenceFor(
  query: string | undefined,
  userId: string | undefined,
) {
  const reserved = approvalReference.getStore()
  if (reserved) return reserved
  if (!query) return undefined
  const params = new URLSearchParams(query)
  const clientId = params.get('client_id')
  const isAgency = params
    .getAll('resource')
    .some((resource) => mcpResourceTarget(resource)?.kind === 'agency')
  if (isAgency) {
    if (!userId || !clientId) return AGENCY_PENDING_REFERENCE
    const connection = await findUsableAgencyConnection({ userId, clientId })
    return connection?.id ?? AGENCY_PENDING_REFERENCE
  }
  const siteId = await siteIdForAuthorizationQuery(query)
  if (!siteId || !userId || !clientId) return siteId
  const connection = await findUsableConnection({ siteId, userId, clientId })
  // A site reference cannot match a generation reference, so missing/idle
  // connections must pass through the application's fresh consent screen.
  return connection?.id ?? siteId
}

/** Exactly one resource, and it must be an Areca MCP resource (site or agency). */
export function assertSingleMcpResource(
  value: string | string[] | null | undefined,
  required: boolean,
) {
  const values = resourceParams(value)
  if (
    (!required && values.length === 0) ||
    (values.length === 1 && mcpResourceTarget(values[0]) !== null)
  )
    return
  throw new APIError('BAD_REQUEST', {
    error: 'invalid_target',
    error_description: 'Exactly one Areca MCP resource is required',
  })
}

/**
 * Whether a connection may carry a token for this resource: an agency
 * connection only for the agency resource, a site connection only for its own
 * site. Keeps a token from one connector from working on the other.
 */
async function connectionMatchesResource(
  connection: { scope: string; siteId: string | null },
  resource: string,
): Promise<boolean> {
  const target = mcpResourceTarget(resource)
  if (!target) return false
  if (target.kind === 'agency') return connection.scope === 'agency'
  if (connection.scope !== 'site' || connection.siteId === null) return false
  const siteId = await siteIdForAuthorizationQuery(
    new URLSearchParams({ resource }).toString(),
  )
  return siteId !== undefined && siteId === connection.siteId
}

function invalidGrant(): never {
  throw new APIError('BAD_REQUEST', {
    error: 'invalid_grant',
    error_description:
      'This app connection expired or was disconnected; connect again',
  })
}

async function activeGeneration(
  referenceId: unknown,
  userId: unknown,
  clientId: unknown,
) {
  if (
    typeof referenceId !== 'string' ||
    typeof userId !== 'string' ||
    typeof clientId !== 'string'
  )
    invalidGrant()
  const [connection] = await db
    .select()
    .from(mcpConnection)
    .where(
      and(
        eq(mcpConnection.id, referenceId),
        eq(mcpConnection.userId, userId),
        eq(mcpConnection.clientId, clientId),
      ),
    )
    .limit(1)
  if (!connection || !isConnectionUsable(connection)) invalidGrant()
  return connection
}

/** Validate refresh before the provider can return a cached rotation response
 * or apply its deployment-wide (client,user) replay invalidation. */
export async function validateMcpRefreshGrant(
  body: Record<string, unknown>,
  ctx: GenericEndpointContext,
) {
  if (
    body.grant_type !== 'refresh_token' ||
    typeof body.refresh_token !== 'string'
  )
    return
  const token = body.refresh_token
  if (!token.startsWith(MCP_REFRESH_TOKEN_PREFIX)) return
  const tokenHash = createHash('sha256')
    .update(token.slice(MCP_REFRESH_TOKEN_PREFIX.length))
    .digest('base64url')
  const [refresh] = await db
    .select()
    .from(oauthRefreshToken)
    .where(eq(oauthRefreshToken.token, tokenHash))
    .limit(1)
  if (!refresh) return // Let the provider perform its normal invalid-token handling.
  if (refresh.expiresAt < new Date()) invalidGrant()
  const connection = await activeGeneration(
    refresh.referenceId,
    refresh.userId,
    refresh.clientId,
  )
  if (!refresh.revoked) return
  if (
    refresh.rotatedAt &&
    refresh.rotationReplayExpiresAt &&
    refresh.rotationReplayExpiresAt >= new Date()
  )
    return
  if (refresh.rotatedAt) {
    const plugin = ctx.context.getPlugin('oauth-provider')
    if (!plugin) invalidGrant()
    const opts = plugin.options
    const provider = getOAuthProviderApi(ctx, opts, 'refresh_token')
    const requestedScopes =
      typeof body.scope === 'string' ? body.scope.split(' ') : refresh.scopes
    if (requestedScopes.some((scope) => !refresh.scopes.includes(scope))) {
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_scope',
        error_description: 'Scope was not originally granted',
      })
    }
    const client = await provider.authenticateClient({
      requireCredentials: false,
      scopes: requestedScopes,
    })
    if (client.clientId !== refresh.clientId) invalidGrant()
    const resources = resourceParams(
      body.resource as string | string[] | undefined,
    )
    if (resources.some((value) => !refresh.resources?.includes(value))) {
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_target',
        error_description: 'requested resource invalid',
      })
    }
    const expectedJkt = getConfirmationJkt(refresh.confirmation)
    const proof = ctx.headers?.get('dpop')
    if (expectedJkt || proof) {
      try {
        await verifyDpopProof({
          proofJwt: proof ?? '',
          method: 'POST',
          url: `${ctx.context.baseURL}/oauth2/token`,
          expectedJkt,
          proofMaxAgeSeconds: opts.dpop?.proofMaxAgeSeconds,
          signingAlgorithms: opts.dpop?.signingAlgorithms,
          replayStore: createDpopReplayStore(ctx.context.internalAdapter),
        })
      } catch {
        throw new APIError('BAD_REQUEST', {
          error: 'invalid_dpop_proof',
          error_description: 'A valid DPoP proof is required',
        })
      }
    }
    await revokeReplayedGrant(connection)
  }
  invalidGrant()
}

/** The provider writes custom token models directly through the configured
 * adapter, so standard Better Auth user/session hooks do not cover them. */
export function mcpOAuthAdapter(
  base: ReturnType<typeof drizzleAdapter>,
): ReturnType<typeof drizzleAdapter> {
  return (options) => {
    const adapter = base(options)
    const create: typeof adapter.create = async (input) => {
      const reservationExpiry: unknown = input.data.expiresAt
      if (
        input.model === 'verification' &&
        typeof input.data.identifier === 'string' &&
        input.data.identifier.startsWith('dpop-proof:') &&
        reservationExpiry instanceof Date
      ) {
        // DPoP iat validation includes the entire final second; reserve through it.
        return adapter.create({
          ...input,
          data: {
            ...input.data,
            expiresAt: new Date(reservationExpiry.getTime() + 1000),
          },
        })
      }
      if (
        input.model !== 'oauthAccessToken' &&
        input.model !== 'oauthRefreshToken'
      )
        return adapter.create(input)
      const data = input.data as Record<string, unknown>
      const connection = await activeGeneration(
        data.referenceId,
        data.userId,
        data.clientId,
      )
      assertSingleMcpResource(data.resources as string[] | undefined, true)
      const resource = (data.resources as string[])[0] ?? ''
      if (!(await connectionMatchesResource(connection, resource)))
        invalidGrant()
      const scopes = Array.isArray(data.scopes) ? data.scopes : []
      // Offline grants intentionally outlive browser login sessions. Otherwise
      // refreshing after the browser session expires issues unusable tokens.
      return adapter.create({
        ...input,
        data: {
          ...input.data,
          ...(scopes.includes('offline_access') ? { sessionId: null } : {}),
        },
      })
    }
    return { ...adapter, create }
  }
}

/** Serialize the complete HTTP token exchange with approval/disconnect,
 * including cached refresh responses that never execute an adapter create. */
export async function handleMcpOAuthTokenRequest(
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (
    request.method !== 'POST' ||
    !new URL(request.url).pathname.replace(/\/+$/, '').endsWith('/oauth2/token')
  )
    return handle(request)
  let body: Record<string, unknown>
  try {
    const text = await readOAuthTokenBody(request)
    body = request.headers.get('content-type')?.includes('application/json')
      ? (JSON.parse(text) as Record<string, unknown>)
      : Object.fromEntries(new URLSearchParams(text))
  } catch (error) {
    if (error instanceof OAuthTokenBodyTooLarge) {
      return Response.json(
        { error: 'Token request body is too large' },
        { status: 413 },
      )
    }
    return handle(request)
  }
  if (!body || typeof body !== 'object') return handle(request)
  let referenceId: string | null | undefined
  if (
    body.grant_type === 'refresh_token' &&
    typeof body.refresh_token === 'string' &&
    body.refresh_token.startsWith(MCP_REFRESH_TOKEN_PREFIX)
  ) {
    const hash = createHash('sha256')
      .update(body.refresh_token.slice(MCP_REFRESH_TOKEN_PREFIX.length))
      .digest('base64url')
    const [row] = await db
      .select({ referenceId: oauthRefreshToken.referenceId })
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.token, hash))
      .limit(1)
    referenceId = row?.referenceId
  } else if (
    body.grant_type === 'authorization_code' &&
    typeof body.code === 'string'
  ) {
    const hash = createHash('sha256').update(body.code).digest('base64url')
    const [row] = await db
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, hash))
      .limit(1)
    try {
      referenceId = row
        ? (JSON.parse(row.value) as { referenceId?: string }).referenceId
        : undefined
    } catch {
      /* provider handles malformed codes */
    }
  }
  if (!referenceId) return handle(request)
  const [connection] = await db
    .select()
    .from(mcpConnection)
    .where(eq(mcpConnection.id, referenceId))
    .limit(1)
  if (!connection) return handle(request)
  return withConnectionLock(connection, () => handle(request))
}
