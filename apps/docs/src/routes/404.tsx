import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '@/components/not-found'
import { seo } from '@/lib/seo'

// Prerendered to /404/index.html; static hosts serve it for unknown URLs.
export const Route = createFileRoute('/404')({
  head: () =>
    seo({
      path: '/404',
      title: 'Page not found',
      description:
        'This page of the Areca CMS docs does not exist or has moved. Search the docs or go back to the documentation home.',
      noindex: true,
    }),
  component: NotFound,
})
