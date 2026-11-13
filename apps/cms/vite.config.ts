import type { IncomingMessage, ServerResponse } from 'node:http'

import { defineConfig } from 'vite'
import type { Plugin, UserConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

import {
  motionFeaturesGroup,
  motionShellModules,
} from './src/build/motion-chunks'
import { phosphorWeights } from './src/build/phosphor-weights'

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

function dropAbandonedRequestErrors(): Plugin {
  return {
    name: 'areca-drop-abandoned-request-errors',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      // Nitro streams a request body to its dev worker. When the browser drops
      // the request first (a cancelled fetch, a page that navigated away), the
      // stream fails ("aborted", "read ECONNRESET") and Vite would show that as
      // an error overlay on every open page, covering what the user or an e2e
      // test clicks. Nobody is waiting for that response, so drop the error.
      return () => {
        server.middlewares.use(
          (
            error: unknown,
            req: IncomingMessage,
            res: ServerResponse,
            next: (error?: unknown) => void,
          ) => {
            if (req.socket.destroyed) res.destroy()
            else next(error)
          },
        )
      }
    },
  }
}

const config = defineConfig(async ({ command }): Promise<UserConfig> => ({
  resolve: { tsconfigPaths: true },
  // E2E runs (scripts/e2e-isolated.mjs, playwright.config.ts) set
  // VITE_FREEZE=true: no file watching and no HMR, so the server keeps
  // serving the code as it was at start and edits elsewhere in the working
  // tree never reload pages or mix old server modules with new client ones
  // mid-test. Restart the server to pick up changes.
  server:
    process.env.VITE_FREEZE === 'true'
      ? { hmr: false, watch: null }
      : undefined,
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            chunkFileNames: (chunk) =>
              chunk.name.startsWith('icons~')
                ? 'assets/icons-[hash].js'
                : 'assets/[name]-[hash].js',
            codeSplitting: {
              groups:
                command === 'build'
                  ? [
                      motionFeaturesGroup(
                        await motionShellModules(import.meta.dirname),
                      ),
                      // Icons used before sign-in stay with the entry; the
                      // rest share one chunk instead of one tiny chunk per
                      // icon.
                      {
                        name: 'icons-initial',
                        test: /@phosphor-icons[\\/]react[\\/]/,
                        tags: ['$initial'],
                        priority: 1,
                        includeDependenciesRecursively: false,
                      },
                      {
                        name: 'icons',
                        test: /@phosphor-icons[\\/]react[\\/]/,
                        entriesAware: true,
                        entriesAwareMergeThreshold: 6_000,
                        includeDependenciesRecursively: false,
                      },
                    ]
                  : [],
            },
          },
        },
      },
    },
  },
  plugins: [
    arecaAssetFileDevPlugin(),
    phosphorWeights(),
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
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
      compressPublicAssets: { gzip: true, brotli: true },
    }),
    tailwindcss(),
    tanstackStart({
      server: {
        entry: 'server.ts',
      },
    }),
    viteReact(),
    dropAbandonedRequestErrors(),
  ],
}))

export default config
