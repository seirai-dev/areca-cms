import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { stringifySearchKeepingRepeats } from './lib/router-search'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from './integrations/tanstack-query/root-provider'
import { deLocalizeUrl, localizeUrl } from '#/paraglide/runtime'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    // Keeps Better Auth's signed sign-in query intact (see lib/router-search.ts).
    stringifySearch: stringifySearchKeepingRepeats,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Shared-element morphs (card → editor, site card → overview) and a
    // soft crossfade between pages (brief §4.5).
    defaultViewTransition: true,
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url),
    },
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

/**
 * Per-route shell options (read by `AppShell`):
 * - `shell: 'focus'` renders the page without the sidebar (the editor);
 * - `shell: 'bare'` renders it with the slim top bar only.
 */
declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    shell?: 'focus' | 'bare'
  }
}
