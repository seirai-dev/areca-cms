import { createFileRoute } from '@tanstack/react-router'

import { UnsubscribeScreen } from '#/features/notifications/unsubscribe-screen'
import type { UnsubscribeResult } from '#/features/notifications/unsubscribe-screen'
import { getUnsubscribeFn } from '#/server/fn/notifications'

type UnsubscribeSearch = {
  /** The signed token from the notification email. */
  token?: string
}

/**
 * `/unsubscribe?token=…`: public, linked from notification emails, so it sits
 * outside `_app` and signed-in people are not redirected away from it.
 */
export const Route = createFileRoute('/unsubscribe')({
  validateSearch: (search: Record<string, unknown>): UnsubscribeSearch => ({
    token:
      typeof search.token === 'string' && search.token !== ''
        ? search.token
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }): Promise<UnsubscribeResult> =>
    deps.token
      ? getUnsubscribeFn({ data: { token: deps.token } })
      : { status: 'invalid' },
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const { token } = Route.useSearch()
  const result = Route.useLoaderData()
  return <UnsubscribeScreen token={token} result={result} />
}
