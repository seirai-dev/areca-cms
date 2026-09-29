import { createFileRoute, redirect } from '@tanstack/react-router'

import { SetupScreen } from '#/features/auth/setup-screen'
import { getAuthMethodsFn } from '#/server/fn/auth-methods'
import { getMeFn } from '#/server/fn/me'
import { getSetupStatusFn } from '#/server/fn/setup'

/** `/setup`: only while no accounts exist; afterwards `/` or `/login`. */
export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    const { needsSetup } = await getSetupStatusFn()
    if (!needsSetup) {
      const me = await getMeFn()
      throw redirect({ href: me ? '/' : '/login' })
    }
  },
  loader: async () => getAuthMethodsFn(),
  component: SetupPage,
})

function SetupPage() {
  const methods = Route.useLoaderData()
  return <SetupScreen methods={methods} />
}
