import { createFileRoute } from '@tanstack/react-router'

import { AccountScreen } from '#/features/account/account-screen'
import { getMyAccountFn, getMySignInMethodFn } from '#/server/fn/account'

/** `/account`: profile, password, two-factor and deleting the account, for the signed-in user. */
export const Route = createFileRoute('/_app/account/')({
  // Someone who still has to enrol in or verify two-factor lands
  // here to do it, but getMyAccountFn is behind that same gate. Skip it
  // until the gate is passed, or the page fails with MFA_REQUIRED. The
  // sign-in method is not gated: enrolling needs it.
  loader: async ({ context }) => {
    const gated =
      context.me.mfaEnrolmentRequired || context.me.mfaVerificationRequired
    const [signIn, account] = await Promise.all([
      getMySignInMethodFn(),
      gated ? null : getMyAccountFn(),
    ])
    return { signIn, account }
  },
  component: AccountPage,
})

function AccountPage() {
  const { me } = Route.useRouteContext()
  const { signIn, account } = Route.useLoaderData()
  return (
    <AccountScreen
      me={me}
      hasPassword={signIn.hasPassword}
      reauth={signIn.reauth}
      deletion={account?.deletion ?? null}
    />
  )
}
