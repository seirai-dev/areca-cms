import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { env } from '#/env'
import { MFA_REQUIRED } from '#/lib/security-errors'
import { getSession } from '#/lib/session.server'
import { setBrandingImage } from '#/server/admin/branding'
import { AssetValidationError } from '#/server/assets'
import { parseLimitedFormData, UploadTooLargeError } from '#/server/http/upload'

// Allow multipart framing and the `kind` field in addition to the 2 MiB image.
const MAX_UPLOAD_BODY_BYTES = 2 * 1024 * 1024 + 256 * 1024

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
        if (!session.user.twoFactorEnabled && env.ADMIN_MFA_REQUIRED) {
          return new Response(MFA_REQUIRED, { status: 403 })
        }

        let form: FormData
        try {
          form = await parseLimitedFormData(request, MAX_UPLOAD_BODY_BYTES)
        } catch (error) {
          if (error instanceof UploadTooLargeError) {
            return new Response('Image exceeds 2 MB', { status: 413 })
          }
          throw error
        }
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
