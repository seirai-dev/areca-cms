import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { handleAgencyMcpRequest } from '#/server/mcp/agency-http'

/**
 * Agency MCP endpoint (Streamable HTTP, stateless): one connector for every
 * client and site, for agency admins. The site is named per call. Accepts a
 * personal agency key. See server/mcp/agency-http.ts and
 * docs/design/agency-mcp.md.
 */
export const Route = createFileRoute('/api/agency/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => handleAgencyMcpRequest(request),
      GET: ({ request }) => handleAgencyMcpRequest(request),
      DELETE: ({ request }) => handleAgencyMcpRequest(request),
    },
  },
})
