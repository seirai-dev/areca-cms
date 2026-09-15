import type { ReactNode } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import {
  DEFAULT_BRANDING,
  brandingCss,
  fontStylesheetUrl,
} from '#/lib/branding'
import type { RouterContext } from '#/lib/router-context'
import { getLocale } from '#/paraglide/runtime'
import { getBrandingFn } from '#/server/fn/branding'

import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', getLocale())
    }
  },

  // Instance branding (name, logo, favicon, accent, font) is read once here
  // and re-read after admins save it via `router.invalidate()`.
  loader: async () => {
    try {
      return await getBrandingFn()
    } catch {
      return DEFAULT_BRANDING
    }
  },
  staleTime: 5 * 60 * 1000,

  head: ({ loaderData }) => {
    const branding = loaderData ?? DEFAULT_BRANDING
    const fontUrl = fontStylesheetUrl(branding.font)
    const css = brandingCss(branding)
    return {
      meta: [
        {
          charSet: 'utf-8',
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          title: branding.appName,
        },
      ],
      links: [
        {
          rel: 'stylesheet',
          href: appCss,
        },
        ...(fontUrl ? [{ rel: 'stylesheet', href: fontUrl }] : []),
        ...(branding.faviconUrl
          ? [
              {
                rel: 'icon',
                href: branding.faviconUrl,
                type: branding.faviconMime ?? undefined,
              },
            ]
          : []),
      ],
      styles: css ? [{ children: css }] : [],
    }
  },
  notFoundComponent: () => (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you are looking for does not exist, or you no longer have
          access to it.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex h-9 items-center rounded-md border bg-background px-4 text-sm font-medium no-underline shadow-xs hover:bg-accent"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  ),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  return <Outlet />
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
