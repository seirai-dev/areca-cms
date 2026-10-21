import { createFileRoute, redirect } from '@tanstack/react-router'

import { ForgotPasswordScreen } from '#/features/auth/forgot-password-screen'
import { getPasswordResetAvailabilityFn } from '#/server/fn/account'
import { getMeFn } from '#/server/fn/me'

/**
 * `/forgot-password`: signed-in people go home. Where password sign-in is off
 * there is nothing to reset, so it goes to /login; where mail is not set up the
 * page explains who can send a link instead.
 */
export const Route = createFileRoute('/forgot-password')({
  beforeLoad: async () => {
    const me = await getMeFn()
    if (me) {
      throw redirect({ href: '/' })
    }
  },
  loader: async () => {
    const availability = await getPasswordResetAvailabilityFn()
    if (availability.reason === 'password_sign_in_disabled') {
      throw redirect({ href: '/login' })
    }
    return availability
  },
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { available } = Route.useLoaderData()
  return <ForgotPasswordScreen available={available} />
}
