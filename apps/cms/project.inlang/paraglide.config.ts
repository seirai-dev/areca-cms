import { defineConfig } from '@inlang/paraglide-js'

/**
 * Shared Paraglide compiler options for the Vite plugin and `paraglide-js compile`.
 *
 * English stays unprefixed so existing CMS URLs and e2e tests keep working.
 * Dutch and Turkish use `/nl` and `/tr` prefixes. API routes are excluded from locale middleware.
 *
 * @see https://paraglidejs.com/tanstack-start
 */
export default defineConfig({
  outdir: './src/paraglide',
  outputStructure: 'locale-modules',
  cookieName: 'PARAGLIDE_LOCALE',
  strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
  isServer: 'import.meta.env.SSR',
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
})
