import { createFileRoute } from '@tanstack/react-router'

import { UploadScreen } from '#/features/upload/upload-screen'
import { getUploadSessionFn } from '#/server/fn/upload-session'

/**
 * `/upload/$token`: the page an AI assistant hands out with
 * create_asset_upload. No sign-in; the link is the credential.
 */
export const Route = createFileRoute('/upload/$token')({
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
  loader: ({ params }) => getUploadSessionFn({ data: { token: params.token } }),
  component: UploadPage,
})

function UploadPage() {
  const session = Route.useLoaderData()
  const { token } = Route.useParams()
  return <UploadScreen token={token} session={session} />
}
