import { createFileRoute } from '@tanstack/react-router'

import { AccountScreen } from '#/features/account/account-screen'
import { getMyAccountFn } from '#/server/fn/account'

/** `/account`: profile, password, two-factor and deleting the account, for the signed-in user. */
export const Route = createFileRoute('/_app/account/')({
  loader: () => getMyAccountFn(),
  component: AccountPage,
})

function AccountPage() {
  const { me } = Route.useRouteContext()
  const { hasPassword, deletion } = Route.useLoaderData()
  return <AccountScreen me={me} hasPassword={hasPassword} deletion={deletion} />
}
