import { defineConfig } from 'vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { host: true },
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      // English only for now. When a second locale is added, switch to
      // ['url', 'baseLocale'] and wrap requests in paraglideMiddleware.
      strategy: ['baseLocale'],
    }),
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true, failOnError: true },
      pages: [{ path: '/' }],
    }),
    react(),
  ],
  resolve: { tsconfigPaths: true },
})
