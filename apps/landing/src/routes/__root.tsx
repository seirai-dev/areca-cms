import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { getLocale } from '@/paraglide/runtime'
import { m } from '@/paraglide/messages'
import { links } from '@/lib/links'
import { themeBootScript } from '@/lib/theme'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: m.meta_title() },
      { name: 'description', content: m.meta_description() },
      { name: 'theme-color', content: '#0e0e10' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Areca' },
      { property: 'og:url', content: links.site },
      { property: 'og:title', content: m.meta_title() },
      { property: 'og:description', content: m.meta_description() },
      { property: 'og:image', content: `${links.site}/og.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: `${links.site}/og.png` },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'canonical', href: `${links.site}/` },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
