import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { handleMetricsRequest } from '#/server/ops/metrics'

export const Route = createFileRoute('/api/metrics')({
  server: {
    handlers: {
      GET: ({ request }) => handleMetricsRequest(request),
    },
  },
})
