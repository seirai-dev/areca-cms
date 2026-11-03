import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { cachedReadinessChecks } from '#/server/ops/health'

export async function getReadiness() {
  const report = await cachedReadinessChecks()
  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: () => getReadiness(),
    },
  },
})
