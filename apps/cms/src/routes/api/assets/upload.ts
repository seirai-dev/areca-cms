import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { getSession, requireOrgMember } from '#/lib/session.server'
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
          return new Response('Unauthorized', { status: 401 })
        }

        let form: FormData
        try {
          form = await parseLimitedFormData(request, MAX_UPLOAD_BODY_BYTES)
        } catch (error) {
          if (error instanceof UploadTooLargeError) {
            return new Response('File exceeds 20 MB', { status: 413 })
          }
          throw error
        }
        const file = form.get('file')
        const organizationId = form.get('organizationId')
        const altText = form.get('altText')

        if (!(file instanceof File)) {
          return new Response('file is required', { status: 400 })
        }
        if (typeof organizationId !== 'string' || !organizationId) {
          return new Response('organizationId is required', { status: 400 })
        }

        try {
          await requireOrgMember(organizationId)
        } catch (err) {
          if (err instanceof Response) return err
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
