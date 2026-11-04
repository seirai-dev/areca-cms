import { createServerFn } from '@tanstack/react-start'

import { z } from '#/lib/zod'
import { publicSessionInfo } from '#/server/assets/upload-sessions'

/**
 * What the public upload page needs before anything is sent. The token is the
 * only credential, so this works without signing in. Null for an unknown link.
 */
export const getUploadSessionFn = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().min(1).max(200) }))
  .handler(({ data }) => publicSessionInfo(data.token))
