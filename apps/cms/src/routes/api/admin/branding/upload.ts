import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { getSession } from '#/lib/session.server'
import { setBrandingImage } from '#/server/admin/branding'
import { AssetValidationError } from '#/server/assets'

export const Route = createFileRoute('/api/admin/branding/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSession()
        if (!session) {
          return new Response('Unauthorized', { status: 401 })
        }
        if (!session.user.isAgencyAdmin) {
          return new Response('Forbidden', { status: 403 })
        }

        const form = await request.formData()
        const file = form.get('file')
        const kind = form.get('kind')

        if (!(file instanceof File)) {
          return new Response('file is required', { status: 400 })
        }
        if (kind !== 'logo' && kind !== 'favicon') {
          return new Response('kind must be logo or favicon', { status: 400 })
        }

        const buffer = Buffer.from(await file.arrayBuffer())

        try {
          const view = await setBrandingImage(
            kind,
            { buffer, mimeType: file.type },
            session.user.id,
          )
          return Response.json(view)
        } catch (err) {
          if (err instanceof AssetValidationError) {
            return new Response(err.message, { status: 400 })
          }
          throw err
        }
      },
    },
  },
})
