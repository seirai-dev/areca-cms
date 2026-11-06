import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { staticFunctionMiddleware } from '@tanstack/start-static-server-functions'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page'
import { useFumadocsLoader } from 'fumadocs-core/source/client'
import { Suspense, use } from 'react'
import { docs, source } from '@/lib/source'
import { baseOptions } from '@/lib/layout.shared'
import { getPageMarkdownUrl, gitConfig } from '@/lib/shared'
import { useMDXComponents } from '@/components/mdx'

export const Route = createFileRoute('/docs/$')({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/').filter(Boolean) ?? []
    const data = await serverLoader({ data: slugs })
    await docs.getPage(data.path)?.preload()
    return data
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const title = `${loaderData.title} · Areca CMS Docs`
    const meta: Array<Record<string, string>> = [
      { title },
      { property: 'og:title', content: title },
    ]
    if (loaderData.description) {
      meta.push(
        { name: 'description', content: loaderData.description },
        { property: 'og:description', content: loaderData.description },
      )
    }
    return { meta }
  },
})

// staticFunctionMiddleware bakes each result into a JSON file at build time,
// so client-side navigation works on a plain static host.
const serverLoader = createServerFn({ method: 'GET' })
  .validator((slugs: string[]) => slugs)
  .middleware([staticFunctionMiddleware])
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      markdownUrl: getPageMarkdownUrl(page).url,
      pageTree: await source.serializePageTree(source.getPageTree()),
    }
  })

function Content({ path, markdownUrl }: { path: string; markdownUrl: string }) {
  const page = docs.getPage(path)
  if (!page) throw new Error(`unknown page: ${path}`)

  const { toc } = use(page.load())
  const MDX = page.body
  const githubUrl = gitConfig.editLinks
    ? `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${gitConfig.contentDir}/${path}`
    : undefined

  return (
    <DocsPage toc={toc} tableOfContent={{ style: 'clerk' }}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <div className="-mt-4 flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={githubUrl} />
      </div>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

function Page() {
  const { path, pageTree, markdownUrl } = useFumadocsLoader(
    Route.useLoaderData(),
  )

  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      <Suspense>
        <Content path={path} markdownUrl={markdownUrl} />
      </Suspense>
    </DocsLayout>
  )
}
