import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import {
  handleSessionFinish,
  handleSessionInfo,
  handleSessionUpload,
} from '#/server/assets/upload-session-http'

/**
 * `/api/upload/$token`: an upload link an AI connection opened with
 * create_asset_upload. The token in the path is the only credential.
 * GET describes the session, PUT saves one file (raw body), POST finishes it.
 */
export const Route = createFileRoute('/api/upload/$token')({
  server: {
    handlers: {
      GET: ({ params }) => handleSessionInfo(params.token),
      PUT: ({ request, params }) => handleSessionUpload(request, params.token),
      POST: ({ params }) => handleSessionFinish(params.token),
    },
  },
})
