import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { requireAgencyAdmin } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { setBrandingImage } from '#/server/admin/branding'
import { AssetValidationError } from '#/server/assets'
import { guardErrorResponse } from '#/server/http/guard-response'
import { parseLimitedFormData, UploadTooLargeError } from '#/server/http/upload'

// Allow multipart framing and the `kind` field in addition to the 2 MiB image.
const MAX_UPLOAD_BODY_BYTES = 2 * 1024 * 1024 + 256 * 1024

export const Route = createFileRoute('/api/admin/branding/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let session: Awaited<ReturnType<typeof requireAgencyAdmin>>
        try {
          session = await requireAgencyAdmin()
        } catch (error) {
          const refused = guardErrorResponse(error)
          if (refused) return refused
          throw error
        }

        let form: FormData
        try {
          form = await parseLimitedFormData(request, MAX_UPLOAD_BODY_BYTES)
        } catch (error) {
          if (error instanceof UploadTooLargeError) {
            return new Response(m.server_image_exceeds_2mb(), { status: 413 })
          }
          throw error
        }
        const file = form.get('file')
        const kind = form.get('kind')

        if (!(file instanceof File)) {
          return new Response(m.server_upload_file_required(), { status: 400 })
        }
        if (kind !== 'logo' && kind !== 'favicon') {
          return new Response(m.server_branding_image_kind_invalid(), {
            status: 400,
          })
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
