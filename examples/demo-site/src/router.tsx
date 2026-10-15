import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { deLocalizeUrl, getLocale, localizeUrl } from '#/paraglide/runtime'
import { toBasePath, toLocalePath } from './lib/locale-routes.ts'

/** A copy of `url` with another pathname. */
function withPathname(url: URL, pathname: string): URL {
  const next = new URL(url.href)
  next.pathname = pathname
  return next
}

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    // Routes are written once in the base language (`/journal/$slug`). The
    // URL the visitor sees is localized (`/nl/journaal/$slug`). Paraglide adds
    // and strips the language prefix; the page segment is translated here, so
    // links, prerendering and the router's own matching all agree.
    rewrite: {
      input: ({ url }) => {
        const base = deLocalizeUrl(url)
        return withPathname(base, toBasePath(base.pathname, getLocale()))
      },
      output: ({ url }) => {
        const locale = getLocale()
        return localizeUrl(withPathname(url, toLocalePath(url.pathname, locale)), { locale })
      },
    },
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
