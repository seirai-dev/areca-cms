import { createFileRoute } from '@tanstack/react-router'

import { SitePicker } from '#/features/sites/site-picker'

/** `/sites`: the site picker (brief §3.2). */
export const Route = createFileRoute('/_app/sites/')({
  component: SitesPage,
})

function SitesPage() {
  const { me } = Route.useRouteContext()
  return <SitePicker me={me} />
}
