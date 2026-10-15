import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { listPrerenderPages } from './src/lib/content.ts'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3001 },
  plugins: [
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    // Locale comes from the URL prefix only (`/nl/...`), so prerendered pages
    // never depend on a cookie or the browser's language.
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['url', 'baseLocale'],
    }),
    tailwindcss(),
    tanstackStart({
      server: { entry: 'server.ts' },
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
        filter: (page) =>
          !page.path.startsWith('/__preview') && !page.path.startsWith('/api'),
      },
      pages: listPrerenderPages().map((path) => ({ path })),
    }),
    viteReact(),
  ],
})

export default config
