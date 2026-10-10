import { createFileRoute, redirect } from '@tanstack/react-router'

import { ConsentScreen } from '#/features/auth/consent-screen'
import { StepUpProvider } from '#/features/security/step-up'
import { m } from '#/paraglide/messages'
import { getOAuthConsentFn } from '#/server/fn/mcp-oauth'
import type { ConsentInfo } from '#/server/mcp/consent'

/**
 * `/oauth/consent`: the consent step of an AI app's sign-in. Outside `_app`
 * (it is reached from the AI app, not the sidebar). The signed query is
 * passed through unchanged; the server verifies it.
 */
export const Route = createFileRoute('/oauth/consent')({
  loader: async ({ location }) => {
    const query = location.searchStr.replace(/^\?/, '')
    const info: ConsentInfo = query
      ? await getOAuthConsentFn({ data: { query } })
      : {
          ok: false,
          reason: 'invalid_request',
          message: m.server_mcp_oauth_link_invalid(),
        }
    if (!info.ok && info.reason === 'signed_out') {
      throw redirect({ href: `/login?${query}` })
    }
    return { query, info }
  },
  component: ConsentPage,
})

function ConsentPage() {
  const { query, info } = Route.useLoaderData()
  return (
    <StepUpProvider>
      <ConsentScreen query={query} info={info} />
    </StepUpProvider>
  )
}
