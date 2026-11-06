import type { ReactNode } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useMatch,
  useRouterState,
} from '@tanstack/react-router'
import { m } from '#/paraglide/messages'
import { NotFoundMessage } from '../components/cms-image.tsx'
import { SiteFooter, SiteHeader } from '../components/site-chrome.tsx'
import { currentLocale } from '../lib/i18n.ts'
import { loadCompanyInfo } from '../lib/queries.ts'
import { SITE_DESCRIPTION, SITE_NAME } from '../lib/seo.ts'
import { VisualMarkers } from '../lib/visual-markers.tsx'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  loader: () => loadCompanyInfo({ data: { locale: currentLocale() } }),
  // Site-wide defaults come from the company info section; pages override them.
  head: ({ loaderData }) => {
    const name = loaderData?.company.name ?? SITE_NAME
    const tagline = loaderData?.company.tagline
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: name },
        { name: 'description', content: tagline ?? SITE_DESCRIPTION },
        { property: 'og:title', content: name },
        { property: 'og:description', content: tagline ?? SITE_DESCRIPTION },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: name },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    }
  },
  component: RootLayout,
  notFoundComponent: NotFoundMessage,
  shellComponent: RootDocument,
})

function RootLayout() {
  const { company } = Route.useLoaderData()
  // Field markers for the visual editor only on the preview routes and on pages
  // opened with a site content draft token (`?arecaPreview=`), never on public pages.
  const preview = useMatch({ from: '/__preview/$collection/$slug', shouldThrow: false }) !== undefined
  const sitePreviewToken = useRouterState({
    select: (state) => (state.location.search as { arecaPreview?: unknown }).arecaPreview,
  })
  const sitePreview = typeof sitePreviewToken === 'string' && sitePreviewToken !== ''
  return (
    <VisualMarkers enabled={preview || sitePreview}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:text-on-primary"
      >
        {m.skip_to_content()}
      </a>
      <SiteHeader />
      <main id="main" className="min-h-[70vh]">
        <Outlet />
      </main>
      <SiteFooter company={company} />
    </VisualMarkers>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={currentLocale()}>
      <head>
        <HeadContent />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#F5F1EA" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#101614" media="(prefers-color-scheme: dark)" />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
