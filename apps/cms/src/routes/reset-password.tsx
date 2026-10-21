import { createFileRoute } from '@tanstack/react-router'

import { ResetPasswordScreen } from '#/features/auth/reset-password-screen'
import { checkPasswordResetTokenFn } from '#/server/fn/account'

type ResetPasswordSearch = {
  /** The one-time token from the reset email. */
  token?: string
}

/** `/reset-password?token=…`: public, reached from the reset email. */
export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    token:
      typeof search.token === 'string' && search.token !== ''
        ? search.token
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) =>
    deps.token
      ? checkPasswordResetTokenFn({ data: { token: deps.token } })
      : { valid: false },
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const { valid } = Route.useLoaderData()
  return <ResetPasswordScreen token={valid ? token : undefined} />
}
