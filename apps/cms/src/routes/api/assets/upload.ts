import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { securityErrorCode } from '#/lib/security-errors'
import { getSession, requireOrgMember } from '#/lib/session.server'
import { m } from '#/paraglide/messages'
import { audit } from '#/server/audit'
import { AssetValidationError, uploadAsset } from '#/server/assets'
import { parseLimitedFormData, UploadTooLargeError } from '#/server/http/upload'

// Allow multipart framing and the small text fields in addition to the 20 MiB file.
const MAX_UPLOAD_BODY_BYTES = 21 * 1024 * 1024

export const Route = createFileRoute('/api/assets/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSession()
        if (!session) {
          return new Response(m.server_unauthorized(), { status: 401 })
        }

        let form: FormData
        try {
          form = await parseLimitedFormData(request, MAX_UPLOAD_BODY_BYTES)
        } catch (error) {
          if (error instanceof UploadTooLargeError) {
            return new Response(m.server_file_exceeds_20mb(), { status: 413 })
          }
          throw error
        }
        const file = form.get('file')
        const organizationId = form.get('organizationId')
        const altText = form.get('altText')

        if (!(file instanceof File)) {
          return new Response(m.server_upload_file_required(), { status: 400 })
        }
        if (typeof organizationId !== 'string' || !organizationId) {
          return new Response(m.server_organization_id_required(), {
            status: 400,
          })
        }

        try {
          await requireOrgMember(organizationId)
        } catch (err) {
          if (err instanceof Response) return err
          // An agency admin without two-factor: a 403 carrying the code, the
          // same shape as the branding upload, not an unhandled 500.
          const code = securityErrorCode(err)
          if (code) return new Response(code, { status: 403 })
          throw err
        }

        const buffer = Buffer.from(await file.arrayBuffer())

        try {
          const row = await uploadAsset({
            organizationId,
            file: {
              buffer,
              filename: file.name,
              mimeType: file.type,
            },
            actorId: session.user.id,
            altText: typeof altText === 'string' ? altText : undefined,
          })
          // Same row the MCP upload writes, so the activity log shows both.
          await audit({
            organizationId,
            actorId: session.user.id,
            action: 'asset.upload',
            targetType: 'asset',
            targetId: row.id,
            meta: { filename: row.originalFilename },
          })
          return Response.json(row)
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
