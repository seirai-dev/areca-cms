import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getPreviewEntry, previewHeaders, toCamelKey } from '@areca-cms/site-sdk'
import type { PreviewEntry } from '@areca-cms/site-sdk'
import { z } from 'zod'
import { content } from '../generated/content/areca.gen.ts'
import type {
  ArticlesEntry,
  AuthorsEntry,
  CoffeesEntry,
} from '../generated/content/areca.gen.ts'
import {
  articlesByAuthor,
  articlesFeaturingCoffee,
  getArticle,
  getArticles,
  getAuthor,
  getAuthors,
  getCoffee,
  getCoffees,
} from './content.ts'

const loose = { strict: { output: false } as const }
const slugInput = z.object({ slug: z.string().min(1) })

/**
 * Search params of pages that can show a site content draft. The CMS opens
 * `<page>?arecaPreview=<token>`; anything else is ignored.
 */
export const sitePreviewSearch = z.object({
  arecaPreview: z.string().optional().catch(undefined),
})
const previewInput = z.object({ arecaPreview: z.string().optional() })

/**
 * Site content for a page that shows `section`. A token for that section
 * replaces it with the draft (`preview: true`). A missing, invalid or
 * other-section token serves the published values. Any request with a token is
 * not indexable and not cacheable.
 */
async function readGlobals(token: string | undefined, section: 'homePage' | 'aboutPage') {
  if (!token) return { globals: content.globals, preview: false, noindex: false }
  const headers = previewHeaders()
  setResponseHeader('X-Robots-Tag', headers['X-Robots-Tag'])
  setResponseHeader('Cache-Control', headers['Cache-Control'])
  try {
    // Fetch the preview once. Only a token for this page's section changes the
    // page; previewGlobals would overlay any section, so check the target first.
    const preview = await getPreviewEntry({ token })
    if (preview.kind === 'global' && toCamelKey(preview.global) === section) {
      return { globals: await content.previewGlobals(preview), preview: true, noindex: true }
    }
  } catch {
    // An expired or mistyped link shows the published page instead of an error.
  }
  return { globals: content.globals, preview: false, noindex: true }
}

/** Company details for the header and footer on every page. */
export const loadCompanyInfo = createServerFn({ method: 'GET', ...loose }).handler(
  () => ({ company: content.globals.companyInfo }),
)

/** Home: hero copy, the featured coffee, the newest journal entries and the first coffees in the shop order. */
export const loadHome = createServerFn({ method: 'GET', ...loose })
  .validator(previewInput)
  .handler(async ({ data }) => {
    const { globals, preview, noindex } = await readGlobals(data.arecaPreview, 'homePage')
    return {
      home: globals.homePage,
      featuredCoffee: content.resolve(globals.homePage.featuredCoffee),
      articles: getArticles().slice(0, 3),
      coffees: getCoffees().slice(0, 3),
      preview,
      noindex,
    }
  })

export const loadAbout = createServerFn({ method: 'GET', ...loose })
  .validator(previewInput)
  .handler(async ({ data }) => {
    const { globals, preview, noindex } = await readGlobals(data.arecaPreview, 'aboutPage')
    return { about: globals.aboutPage, preview, noindex }
  })

export const loadCoffees = createServerFn({ method: 'GET', ...loose }).handler(
  () => getCoffees(),
)

export const loadCoffee = createServerFn({ method: 'GET', ...loose })
  .validator(slugInput)
  .handler(({ data }) => {
    const coffee = getCoffee(data.slug)
    if (!coffee) return null
    return {
      coffee,
      articles: articlesFeaturingCoffee(coffee.id),
    }
  })

export const loadJournal = createServerFn({ method: 'GET', ...loose }).handler(
  () => getArticles(),
)

export const loadArticle = createServerFn({ method: 'GET', ...loose })
  .validator(slugInput)
  .handler(({ data }) => {
    const article = getArticle(data.slug)
    if (!article) return null
    return {
      article,
      author: content.resolve(article.data.author),
      coffee: content.resolve(article.data.featuredCoffee),
    }
  })

export const loadTeam = createServerFn({ method: 'GET', ...loose }).handler(
  () => getAuthors(),
)

export const loadAuthor = createServerFn({ method: 'GET', ...loose })
  .validator(slugInput)
  .handler(({ data }) => {
    const author = getAuthor(data.slug)
    if (!author) return null
    return {
      author,
      articles: articlesByAuthor(author.id),
    }
  })

export type PreviewData =
  | { collection: 'articles'; entry: ArticlesEntry; author: AuthorsEntry | null; coffee: CoffeesEntry | null }
  | { collection: 'coffees'; entry: CoffeesEntry; articles: ArticlesEntry[] }
  | { collection: 'authors'; entry: AuthorsEntry; articles: ArticlesEntry[] }

/** A complete draft renders like a published entry; an incomplete one lists what is missing. */
export type PreviewLoad =
  | { ok: true; complete: true; preview: PreviewData }
  | { ok: true; complete: false; collection: string; issues: string[] }
  | { ok: false; error: string }

/**
 * Draft preview for any collection. Related entries (author, coffee, articles)
 * resolve against the local snapshot, so drafts that reference unpublished
 * entries show those references as absent.
 */
export const loadPreview = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }): Promise<PreviewLoad> => {
    const headers = previewHeaders()
    setResponseHeader('X-Robots-Tag', headers['X-Robots-Tag'])
    setResponseHeader('Cache-Control', headers['Cache-Control'])
    try {
      return toPreviewLoad(await content.preview(data.token))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch preview'
      return { ok: false, error: message }
    }
  })

function toPreviewLoad(result: PreviewEntry): PreviewLoad {
  if (!result.complete) {
    return { ok: true, complete: false, collection: result.collection, issues: result.issues }
  }
  return { ok: true, complete: true, preview: toPreviewData(result) }
}

function toPreviewData(result: Extract<PreviewEntry, { complete: true }>): PreviewData {
  switch (result.collection) {
    case 'articles':
      return {
        collection: 'articles',
        entry: result.entry,
        author: content.resolve(result.entry.data.author),
        coffee: content.resolve(result.entry.data.featuredCoffee),
      }
    case 'coffees':
      return {
        collection: 'coffees',
        entry: result.entry,
        articles: articlesFeaturingCoffee(result.entry.id),
      }
    case 'authors':
      return {
        collection: 'authors',
        entry: result.entry,
        articles: articlesByAuthor(result.entry.id),
      }
  }
}
