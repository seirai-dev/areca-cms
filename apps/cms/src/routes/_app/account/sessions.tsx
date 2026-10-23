import { createFileRoute, redirect } from '@tanstack/react-router'

import { SessionsScreen } from '#/features/account/sessions-screen'

/**
 * `/account/sessions`. Agency admins who still have to enrol in two-factor,
 * or verify with their authenticator, go to the account page first.
 */
export const Route = createFileRoute('/_app/account/sessions')({
  beforeLoad: ({ context }) => {
    if (context.me.mfaEnrolmentRequired || context.me.mfaVerificationRequired) {
      throw redirect({ to: '/account' })
    }
  },
  component: SessionsScreen,
})
