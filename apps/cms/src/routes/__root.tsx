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

import { NotFoundCard } from '#/components/shell/not-found'
import { RouteErrorCard } from '#/components/shell/route-error'
import { ThemeProvider } from '#/components/theme'
import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import {
  DEFAULT_BRANDING,
  FONTS,
  brandingCss,
  fontEntry,
  fontStylesheetUrl,
} from '#/lib/branding'
import type { RouterContext } from '#/lib/router-context'
import { getLocale } from '#/paraglide/runtime'
import { getBrandingFn } from '#/server/fn/branding'

import appCss from '../styles.css?url'
import interLatinUrl from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url'

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
    const css = brandingCss(branding)
    // The branded Google Font, so the whole app renders in it (the preview
    // loads its own copy). Self-hosted fonts need no stylesheet.
    const fontUrl = fontStylesheetUrl(branding.font)
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
        // The default font is only discovered once styles.css has loaded;
        // fetch its Latin file alongside the stylesheet instead.
        ...(fontEntry(branding.font) === FONTS.inter
          ? [
              {
                rel: 'preload',
                href: interLatinUrl,
                as: 'font',
                type: 'font/woff2',
                crossOrigin: 'anonymous' as const,
              },
            ]
          : []),
        branding.faviconUrl
          ? {
              rel: 'icon',
              href: branding.faviconUrl,
              type: branding.faviconMime ?? undefined,
            }
          : { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      ],
      styles: css ? [{ children: css }] : [],
    }
  },
  notFoundComponent: () => <NotFoundCard fullPage />,
  errorComponent: RouteErrorCard,
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  return <Outlet />
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
            // Dev only. The floating trigger covered the mobile tab bar and the
            // account row; open the devtools with their hotkey instead.
            triggerHidden: true,
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
