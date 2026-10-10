import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { handleMcpRequest } from '#/server/mcp/http'

/**
 * Per-site MCP endpoint (Streamable HTTP, stateless). Authenticated by a
 * personal, per-site bearer key, never by a cookie. See server/mcp/http.ts.
 */
export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => handleMcpRequest(request),
      GET: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
})
