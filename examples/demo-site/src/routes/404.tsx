import { createFileRoute } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { NotFoundMessage } from '../components/cms-image.tsx'
import { noindexHead, pageHead } from '../lib/seo.ts'

/**
 * The not-found page as a real route, so it can be prerendered: a static host
 * serves `404.html` (copied from `/404` and `/nl/404` by `build:static`) for
 * paths the site does not have.
 */
export const Route = createFileRoute('/404')({
  head: () => noindexHead(pageHead({ title: m.error_404_title() })),
  component: NotFoundMessage,
})
