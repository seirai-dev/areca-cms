import { createFileRoute, notFound } from '@tanstack/react-router'

import { InviteInvalid, InviteScreen } from '#/features/auth/invite-screen'
import { getAuthMethodsFn } from '#/server/fn/auth-methods'
import { getInvitationFn } from '#/server/fn/me'

/** `/invite/$token`: join a client; invalid or used links get a friendly card. */
export const Route = createFileRoute('/invite/$token')({
  validateSearch: (search: Record<string, unknown>) => ({
    // Better Auth appends this when a provider round-trip fails.
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  loader: async ({ params }) => {
    try {
      const [invitation, methods] = await Promise.all([
        getInvitationFn({ data: { token: params.token } }),
        getAuthMethodsFn(),
      ])
      return { invitation, methods }
    } catch {
      throw notFound()
    }
  },
  notFoundComponent: InviteInvalid,
  component: InvitePage,
})

function InvitePage() {
  const { invitation, methods } = Route.useLoaderData()
  const { token } = Route.useParams()
  const { error } = Route.useSearch()
  return (
    <InviteScreen
      token={token}
      invitation={invitation}
      methods={methods}
      providerError={error}
    />
  )
}
