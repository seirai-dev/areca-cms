import { createFileRoute, notFound } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { CoffeeView } from '../../components/coffee-view.tsx'
import { PageMessage } from '../../components/cms-image.tsx'
import { loadCoffee } from '../../lib/queries.ts'
import { entryHead, pageHead } from '../../lib/seo.ts'
import { currentLocale } from '../../lib/i18n.ts'

export const Route = createFileRoute('/coffees/$slug')({
  loader: async ({ params }) => {
    const data = await loadCoffee({ data: { locale: currentLocale(), slug: params.slug } })
    if (!data) throw notFound()
    return data
  },
  head: ({ loaderData }) =>
    loaderData
      ? entryHead(
          loaderData.coffee,
          {
            title: loaderData.coffee.data.name,
            description: [loaderData.coffee.data.origin, loaderData.coffee.data.region]
              .filter(Boolean)
              .join(', '),
          },
          loaderData.alternates,
        )
      : pageHead({ title: m.coffee_not_found() }),
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
    <PageMessage title={m.coffee_not_found()}>
      {m.coffee_not_found_body({ slug })}
    </PageMessage>
  )
}
