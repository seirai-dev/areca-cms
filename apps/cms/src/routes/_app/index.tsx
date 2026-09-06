import { Link, createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '#/components/empty-state'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { me } = Route.useRouteContext()

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Dashboard"
        description="Sites you can work on."
        actions={
          me.user.isAgencyAdmin ? (
            <Button asChild variant="outline">
              <a href="/admin/organizations">Organizations</a>
            </Button>
          ) : null
        }
      />
      {me.sites.length === 0 ? (
        <EmptyState
          title="No sites yet"
          description="You do not have access to any sites."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {me.sites.map((site) => (
            <Card key={site.id}>
              <CardHeader>
                <CardTitle>
                  <Link
                    to="/sites/$siteId"
                    params={{ siteId: site.id }}
                    className="hover:underline"
                  >
                    {site.name}
                  </Link>
                </CardTitle>
                <CardDescription>{site.organizationName}</CardDescription>
              </CardHeader>
              <CardContent>
                <a
                  href={site.productionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm"
                >
                  {site.productionUrl}
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
