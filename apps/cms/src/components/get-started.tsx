import { Link } from '@tanstack/react-router'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export function GetStarted() {
  return (
    <Card data-testid="get-started">
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          Agency admin checklist for the first site.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid list-decimal gap-4 pl-5 text-sm">
          <li>
            <Link
              to="/admin/organizations"
              className="font-medium underline underline-offset-4"
            >
              Create an organization
            </Link>
          </li>
          <li>
            Create a site and copy its token. The token is shown once — store it
            as <code className="rounded bg-muted px-1">ARECA_SITE_TOKEN</code>.
          </li>
          <li>
            Connect your site. In the site package (for the demo,{' '}
            <code className="rounded bg-muted px-1">examples/demo-site</code>
            ), write <code className="rounded bg-muted px-1">.env.local</code>
            :
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-6">
              {`ARECA_CMS_URL=http://localhost:3000
ARECA_SITE_TOKEN=<paste the site token>`}
            </pre>
            Then run{' '}
            <code className="rounded bg-muted px-1">
              pnpm --filter @areca/demo-site sync-manifest
            </code>
            .
          </li>
          <li>Create and publish content in a collection.</li>
          <li>
            Click <span className="font-medium">Publish site</span> on the site
            dashboard so the demo site can pull a snapshot.
          </li>
        </ol>
      </CardContent>
    </Card>
  )
}
