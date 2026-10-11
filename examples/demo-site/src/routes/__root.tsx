import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { PageMessage } from '../components/cms-image.tsx'
import { SiteFooter, SiteHeader } from '../components/site-chrome.tsx'
import { pageHead, SITE_DESCRIPTION } from '../lib/seo.ts'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ...pageHead({ description: SITE_DESCRIPTION }).meta,
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  component: RootLayout,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function RootLayout() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:text-on-primary"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="min-h-[70vh]">
        <Outlet />
      </main>
      <SiteFooter />
    </>
  )
}

function NotFound() {
  return (
    <PageMessage eyebrow="Error 404" title="Off the map.">
      That page is not on the Northbound Coffee Co. site.
    </PageMessage>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
