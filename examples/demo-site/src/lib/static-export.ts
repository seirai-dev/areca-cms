import { staticFunctionMiddleware } from '@tanstack/start-static-server-functions'

/**
 * True in the static build (`pnpm build:static`), which has no server: every
 * page is prerendered HTML and the data for in-app navigation is JSON files.
 * The Node build (`pnpm build`) keeps a server for drafts and the visual editor.
 */
export const STATIC_EXPORT = import.meta.env.VITE_STATIC_EXPORT === 'true'

/**
 * Middleware for the server functions that read published content. In the
 * static build, prerendering saves each result as a JSON file and the browser
 * fetches that file instead of calling the server. Each result is keyed by its
 * input, so a function must take everything its result depends on (such as
 * the language) as input.
 */
export const publishedDataMiddleware = STATIC_EXPORT ? [staticFunctionMiddleware] : []
