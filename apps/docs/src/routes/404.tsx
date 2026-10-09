import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '@/components/not-found'

// Prerendered to /404/index.html; static hosts serve it for unknown URLs.
export const Route = createFileRoute('/404')({
  head: () => ({ meta: [{ title: 'Page not found · Areca Docs' }] }),
  component: NotFound,
})
