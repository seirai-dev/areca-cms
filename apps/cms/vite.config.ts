import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
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

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  server: {
    // E2E runs set this so edits elsewhere in the working tree never reload
    // pages mid-test (scripts/e2e-isolated.mjs, playwright.config.ts).
    hmr: process.env.VITE_DISABLE_HMR === 'true' ? false : undefined,
  },
  plugins: [
    arecaAssetFileDevPlugin(),
    devtools(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      // Fewer modules keep dev hydration fast; production keeps per-message tree-shaking.
      outputStructure:
        command === 'serve' ? 'locale-modules' : 'message-modules',
      cookieName: 'PARAGLIDE_LOCALE',
      strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
      urlPatterns: [
        {
          pattern: ':protocol://:domain(.*)::port?/:path(.*)?',
          localized: [
            ['nl', ':protocol://:domain(.*)::port?/nl/:path(.*)?'],
            ['tr', ':protocol://:domain(.*)::port?/tr/:path(.*)?'],
            ['en', ':protocol://:domain(.*)::port?/:path(.*)?'],
          ],
        },
      ],
      routeStrategies: [{ match: '/api/:path(.*)?', exclude: true }],
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
}))

export default config
