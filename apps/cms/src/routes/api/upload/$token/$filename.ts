import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { handleSessionUpload } from '#/server/assets/upload-session-http'

/** `curl -T photo.jpg <uploadUrl>/` appends the file name; it becomes the stored name. */
export const Route = createFileRoute('/api/upload/$token/$filename')({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        handleSessionUpload(request, params.token, params.filename),
    },
  },
})
