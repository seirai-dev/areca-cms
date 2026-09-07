import { Link, Outlet, createFileRoute, notFound } from '@tanstack/react-router'

import { PageHeader } from '#/components/page-header'

export const Route = createFileRoute('/_app/sites/$siteId')({
  beforeLoad: ({ context, params }) => {
    const site = context.me?.sites.find((item) => item.id === params.siteId)
    if (!site) {
      throw notFound()
    }
    return { site }
  },
  component: SiteLayout,
})

function SiteLayout() {
  const { site, me } = Route.useRouteContext()
  const { siteId } = Route.useParams()

  return (
    <div className="grid gap-6">
      <PageHeader title={site.name} description={site.slug} />
      <nav className="flex flex-wrap gap-3 text-sm">
        <Link to="/sites/$siteId" params={{ siteId }} className="hover:underline">
          Content
        </Link>
        <Link
          to="/sites/$siteId/media"
          params={{ siteId }}
          className="hover:underline"
        >
          Media
        </Link>
        <Link
          to="/sites/$siteId/releases"
          params={{ siteId }}
          className="hover:underline"
        >
          Releases
        </Link>
        {me.user.isAgencyAdmin ? (
          <a href={`/sites/${siteId}/settings`} className="hover:underline">
            Settings
          </a>
        ) : null}
      </nav>
      <Outlet />
    </div>
  )
}
