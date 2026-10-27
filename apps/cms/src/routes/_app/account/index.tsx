import { createFileRoute } from '@tanstack/react-router'

import { AccountScreen } from '#/features/account/account-screen'
import { getMyAccountFn } from '#/server/fn/account'

/** `/account`: profile, password, two-factor and deleting the account, for the signed-in user. */
export const Route = createFileRoute('/_app/account/')({
  // An agency admin who still has to enrol in or verify two-factor lands
  // here to do it, but getMyAccountFn is behind that same gate. Skip it
  // until the gate is passed, or the page fails with MFA_REQUIRED.
  loader: ({ context }) =>
    context.me.mfaEnrolmentRequired || context.me.mfaVerificationRequired
      ? null
      : getMyAccountFn(),
  component: AccountPage,
})

function AccountPage() {
  const { me } = Route.useRouteContext()
  const account = Route.useLoaderData()
  return (
    <AccountScreen
      me={me}
      hasPassword={account?.hasPassword ?? false}
      deletion={account?.deletion ?? null}
    />
  )
}
