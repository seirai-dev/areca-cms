import { createFileRoute, notFound } from '@tanstack/react-router'
import { AuthorView } from '../../components/author-view.tsx'
import { PageMessage } from '../../components/cms-image.tsx'
import { loadAuthor } from '../../lib/queries.ts'
import { entryHead, pageHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/team/$slug')({
  loader: async ({ params }) => {
    const data = await loadAuthor({ data: { slug: params.slug } })
    if (!data) throw notFound()
    return data
  },
  head: ({ loaderData }) =>
    loaderData
      ? entryHead(loaderData.author, {
          title: loaderData.author.data.name,
          description: loaderData.author.data.bio,
        })
      : pageHead({ title: 'Team member not found' }),
  component: TeamMember,
  notFoundComponent: TeamMemberMissing,
})

function TeamMember() {
  const { author, articles } = Route.useLoaderData()
  return <AuthorView author={author} articles={articles} />
}

function TeamMemberMissing() {
  const { slug } = Route.useParams()
  return (
    <PageMessage title="Team member not found">
      No team member with slug “{slug}”.
    </PageMessage>
  )
}
