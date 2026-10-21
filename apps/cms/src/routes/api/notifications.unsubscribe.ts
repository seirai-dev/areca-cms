import { createFileRoute } from '@tanstack/react-router'
import '@tanstack/react-start'

import { applyUnsubscribe } from '#/server/notifications/unsubscribe'

/**
 * RFC 8058 one-click unsubscribe, named by the List-Unsubscribe header. Mail
 * clients POST here with the token in the query; nothing else is accepted.
 */
export const Route = createFileRoute('/api/notifications/unsubscribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = new URL(request.url).searchParams.get('token') ?? ''
        const result = await applyUnsubscribe(token)
        return Response.json(result, { status: result.ok ? 200 : 400 })
      },
    },
  },
})
