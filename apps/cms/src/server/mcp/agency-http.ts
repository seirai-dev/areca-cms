import { createMcpHandler } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'

import { bearerToken } from '#/server/http/bearer-token'

import { createArecaAgencyMcpServer } from './agency-server'
import type { AgencyPrincipal } from './keys'
import { MCP_KEY_PREFIX, resolveAgencyPrincipal } from './keys'
import {
  MCP_TRANSPORT_OPTIONS,
  mfaRequired,
  unauthorized,
  unknownSite,
} from './http'

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

function wrongScope(): Response {
  return Response.json(
    {
      error:
        'This key is for one site. Use that site’s connector address, or create an agency key.',
    },
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="areca-mcp"' },
    },
  )
}

/**
 * The agency connector endpoint `/api/agency/mcp`. Accepts a personal agency
 * key (`areca_mcp_…` with scope `agency`) whose owner is an agency admin with
 * MFA. OAuth for this resource comes in a later step, so other tokens get the
 * plain 401 here.
 *
 * Anyone who is not an agency admin gets the same 404 an unknown site gets
 * (`{"error":"Site not found"}`), as the dev env rule does on the site
 * connector (docs/design/dev-environments.md, Decision 3). Missing or unknown
 * credentials get the 401.
 */
export async function handleAgencyMcpRequest(
  request: Request,
): Promise<Response> {
  const token = bearerToken(request)
  if (!token?.startsWith(MCP_KEY_PREFIX)) return unauthorized()

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
        return unauthorized()
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
