import { createFileRoute } from '@tanstack/react-router'
import { getManifest } from '../../lib/content.ts'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => {
        try {
          const manifest = getManifest()
          return Response.json({
            ok: true,
            publicationId: manifest.publicationId,
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Content manifest missing'
          return Response.json({ ok: false, error: message }, { status: 503 })
        }
      },
    },
  },
})
