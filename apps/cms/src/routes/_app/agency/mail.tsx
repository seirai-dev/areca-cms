import { createFileRoute } from '@tanstack/react-router'

import { MailSettingsScreen } from '#/features/agency/mail-settings-screen'

/** `/agency/mail`: sending server (or environment), test and recent emails. */
export const Route = createFileRoute('/_app/agency/mail')({
  component: MailSettingsScreen,
})
