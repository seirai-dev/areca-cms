import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { MFA_REQUIRED, MfaRequiredError } from '#/lib/security-errors'
import { getSession } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { setBrandingImage } from '#/server/admin/branding'
import { AssetValidationError } from '#/server/assets'
import { parseLimitedFormData, UploadTooLargeError } from '#/server/http/upload'
import { requireAdminLocalMfa } from '#/server/security/local-mfa'

// Allow multipart framing and the `kind` field in addition to the 2 MiB image.
const MAX_UPLOAD_BODY_BYTES = 2 * 1024 * 1024 + 256 * 1024

export const Route = createFileRoute('/api/admin/branding/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSession()
        if (!session) {
          return new Response(m.server_unauthorized(), { status: 401 })
        }
        if (!session.user.isAgencyAdmin) {
          return new Response(m.server_forbidden(), { status: 403 })
        }
        // Same guard as `requireAgencyAdmin` for the server functions: two-factor
        // enrolled and verified locally for this session.
        try {
          await requireAdminLocalMfa(session)
        } catch (error) {
          if (error instanceof MfaRequiredError) {
            return new Response(MFA_REQUIRED, { status: 403 })
          }
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
