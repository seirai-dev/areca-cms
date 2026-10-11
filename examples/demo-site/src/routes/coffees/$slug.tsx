import { createFileRoute, notFound } from '@tanstack/react-router'
import { CoffeeView } from '../../components/coffee-view.tsx'
import { PageMessage } from '../../components/cms-image.tsx'
import { loadCoffee } from '../../lib/queries.ts'
import { entryHead, pageHead } from '../../lib/seo.ts'

export const Route = createFileRoute('/coffees/$slug')({
  loader: async ({ params }) => {
    const data = await loadCoffee({ data: { slug: params.slug } })
    if (!data) throw notFound()
    return data
  },
  head: ({ loaderData }) =>
    loaderData
      ? entryHead(loaderData.coffee, {
          title: loaderData.coffee.data.name,
          description: [loaderData.coffee.data.origin, loaderData.coffee.data.region]
            .filter(Boolean)
            .join(', '),
        })
      : pageHead({ title: 'Coffee not found' }),
  component: CoffeePage,
  notFoundComponent: CoffeeMissing,
})

function CoffeePage() {
  const { coffee, articles } = Route.useLoaderData()
  return <CoffeeView coffee={coffee} articles={articles} />
}

function CoffeeMissing() {
  const { slug } = Route.useParams()
  return (
    <PageMessage title="Coffee not found">
      No coffee with slug “{slug}” is on the shelf.
    </PageMessage>
  )
}
