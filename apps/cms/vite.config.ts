import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const ASSET_FILE_PREFIX = '/api/assets/file/'

function arecaAssetFileDevPlugin(): Plugin {
  return {
    name: 'areca-asset-file-dev',
    configureServer(server) {
      // Nitro skips URLs with asset extensions (`.png`) and Sec-Fetch-Dest: image
      // as static files, so Start never sees GET /api/assets/file/.../*.png.
      // Treat those requests as documents so they reach the server route.
      server.middlewares.use((req, _res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (pathname.startsWith(ASSET_FILE_PREFIX)) {
          req.headers['sec-fetch-dest'] = 'document'
          req.headers.accept = 'text/html'
        }
        next()
      })
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    arecaAssetFileDevPlugin(),
    devtools(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['url', 'baseLocale'],
    }),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart({
      server: {
        entry: 'server.ts',
      },
    }),
    viteReact(),
  ],
})


export default config
