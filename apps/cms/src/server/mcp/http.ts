import { createMcpHandler } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'

import { createLogger } from '#/server/log'

import type { McpActor } from './keys'
import { resolveMcpActorResult, MCP_KEY_PREFIX } from './keys'
import { createArecaMcpServer } from './server'

const log = createLogger('mcp')

/** Largest JSON-RPC body accepted; a 1 MB entry plus Markdown fits well inside. */
const MAX_REQUEST_BODY_BYTES = 1_048_576

const handler = createMcpHandler(
  (ctx: McpRequestContext) => createArecaMcpServer(actorFrom(ctx)),
  {
    legacy: 'stateless',
    responseMode: 'json',
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    onerror: (error) => log.warn('MCP protocol error', { err: error }),
  },
)

/** The actor travels in authInfo.extra, set per request after authentication. */
function actorFrom(ctx: McpRequestContext): McpActor {
  const actor = ctx.authInfo?.extra?.actor
  if (!isActor(actor)) {
    throw new Error('MCP request reached the server without an authenticated actor')
  }
  return actor
}

function isActor(value: unknown): value is McpActor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'keyId' in value &&
    'siteId' in value &&
    'role' in value
  )
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.startsWith(MCP_KEY_PREFIX) ? token : null
}

export const MFA_REQUIRED_MESSAGE =
  'Your account needs two-factor authentication before AI keys work. Turn it on in Account settings.'

function mfaRequired(): Response {
  return Response.json({ error: MFA_REQUIRED_MESSAGE, code: 'mfa_required' }, { status: 403 })
}

function unauthorized(): Response {
  return Response.json(
    { error: 'Invalid or expired Areca MCP key' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="areca-mcp"' },
    },
  )
}

/**
 * Serves one MCP request for the site the bearer key belongs to. Every
 * request is authenticated again, so a revoked or expired key stops working
 * at once even for an open session.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const token = bearerToken(request)
  const resolution = token
    ? await resolveMcpActorResult(token)
    : { ok: false as const, reason: 'invalid' as const }
  if (!resolution.ok) {
    return resolution.reason === 'mfa_required' ? mfaRequired() : unauthorized()
  }
  const actor = resolution.actor

  return handler.fetch(request, {
    authInfo: {
      // Never the secret: the key id is enough for logs and audit labels.
      token: actor.keyId,
      clientId: actor.keyId,
      scopes: [],
      extra: { actor },
    },
  })
}
