import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/sites/$siteId/')({
  component: SiteContentPage,
})

function SiteContentPage() {
  return <p>Content — coming</p>
}
