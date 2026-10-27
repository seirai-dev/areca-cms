import { createFileRoute } from '@tanstack/react-router'

import { AgencyConnectAiScreen } from '#/features/connect-ai/agency-connect-ai-screen'

/** `/agency/connect-ai`: one AI connector for every client and site (agency admins). */
export const Route = createFileRoute('/_app/agency/connect-ai')({
  component: AgencyConnectAiScreen,
})
