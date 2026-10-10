import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { handleSiteMcpRequest } from '#/server/mcp/http'

/**
 * Per-site MCP endpoint (Streamable HTTP, stateless): the connector URL for one
 * site. Accepts an OAuth access token issued for this site, or a personal key
 * for this site. See server/mcp/http.ts.
 */
export const Route = createFileRoute('/api/mcp/$siteSlug')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleSiteMcpRequest(request, params.siteSlug),
      GET: ({ request, params }) =>
        handleSiteMcpRequest(request, params.siteSlug),
      DELETE: ({ request, params }) =>
        handleSiteMcpRequest(request, params.siteSlug),
    },
  },
})
