import { createFileRoute } from '@tanstack/react-router'

import { ConnectAiScreen } from '#/features/connect-ai/connect-ai-screen'

/** `/sites/$siteId/connect-ai`: personal AI keys for this site (every member). */
export const Route = createFileRoute('/_app/sites/$siteId/connect-ai')({
  component: ConnectAiPage,
})

function ConnectAiPage() {
  const { site } = Route.useRouteContext()
  return <ConnectAiScreen site={site} />
}
