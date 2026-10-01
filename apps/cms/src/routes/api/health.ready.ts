import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { runReadinessChecks } from '#/server/ops/health'

export async function getReadiness() {
  const report = await runReadinessChecks()
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
