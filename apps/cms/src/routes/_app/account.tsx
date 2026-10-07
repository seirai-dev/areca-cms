import { createFileRoute } from '@tanstack/react-router'

import { AccountScreen } from '#/features/account/account-screen'

/** `/account`: profile and two-factor authentication for the signed-in user. */
export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
})

function AccountPage() {
  const { me } = Route.useRouteContext()
  return <AccountScreen me={me} />
}
