import { createFileRoute } from '@tanstack/react-router'
import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

const server = createFromSource(source, {
  language: 'english',
})

// Prerendered into a static index file; see components/search.tsx.
export const Route = createFileRoute('/api/search')({
  server: {
    handlers: {
      GET: async () => server.staticGET(),
    },
  },
})
