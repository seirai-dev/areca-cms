import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { listPrerenderPages } from './src/lib/content.ts'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3001 },
  plugins: [
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
        filter: (page) =>
          !page.path.startsWith('/__preview') && !page.path.startsWith('/api'),
      },
      pages: listPrerenderPages(),
    }),
    viteReact(),
  ],
})

export default config
