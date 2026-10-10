import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { handleMcpRequest } from '#/server/mcp/http'

/**
 * Personal-key MCP endpoint (Streamable HTTP, stateless). Kept for scripts and
 * CI. Apps connect to the per-site URL `/api/mcp/<siteSlug>` instead. Keys are
 * authenticated by bearer token, never by a cookie. See server/mcp/http.ts.
 */
export const Route = createFileRoute('/api/mcp/')({
  server: {
    handlers: {
      POST: ({ request }) => handleMcpRequest(request),
      GET: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
})
