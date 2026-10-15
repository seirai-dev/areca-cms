import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { previewHeaders } from '@areca-cms/site-sdk'
import type { PreviewEntry } from '@areca-cms/site-sdk'
import { z } from 'zod'
import { content } from '../generated/content/areca.gen.ts'
import type {
  ArticlesEntry,
  AuthorsEntry,
  CoffeesEntry,
} from '../generated/content/areca.gen.ts'
import { SITE_DESCRIPTION, SITE_NAME } from './seo.ts'
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
 * Site content sections as a publication may lack them: a section with no
 * content is left out of the snapshot, so every read goes through this type.
 */
type Sections = Partial<typeof content.globals>

/** Used when the company info section is missing. */
const COMPANY_FALLBACK = { name: SITE_NAME }

/** Used when the home page section is missing: the hero shows the default intro and no eyebrow. */
const HOME_FALLBACK = {
  heroEyebrow: null,
  heroIntro: SITE_DESCRIPTION,
  featuredCoffee: null,
  $seo: null,
}

/** Used when the about page section is missing: a minimal page with the site name as heading. */
const ABOUT_FALLBACK = {
  heading: SITE_NAME,
  body: null,
  image: null,
  foundedYear: null,
  roasterCapacityKg: null,
  originsCount: null,
  $seo: null,
}

/** Company details with fallbacks for a missing section. */
export function companyFrom(globals: Sections) {
  return { ...COMPANY_FALLBACK, ...globals.companyInfo }
}

/** Home page copy with fallbacks for a missing section. */
export function homeFrom(globals: Sections) {
  return globals.homePage ?? HOME_FALLBACK
}

/** About page copy with fallbacks for a missing section. */
export function aboutFrom(globals: Sections) {
  return globals.aboutPage ?? ABOUT_FALLBACK
}

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
 * shows its draft (`preview: true`); when the draft is incomplete, the published
 * values stay and `incomplete: true` is set. A missing, invalid or other-section
 * token serves the published values. Any request with a token is not indexable
 * and not cacheable.
 */
async function readGlobals(
  token: string | undefined,
  section: 'homePage' | 'aboutPage',
): Promise<{ globals: Sections; preview: boolean; incomplete: boolean; noindex: boolean }> {
  if (!token) return { globals: content.globals, preview: false, incomplete: false, noindex: false }
  const headers = previewHeaders()
  setResponseHeader('X-Robots-Tag', headers['X-Robots-Tag'])
  setResponseHeader('Cache-Control', headers['Cache-Control'])
  try {
    // previewGlobals fetches the token once. Its `previewing` says which section
    // the token targets; only that section's page is changed by the preview.
    const { globals, previewing, complete } = await content.previewGlobals(token)
    if (previewing === section) {
      return { globals, preview: true, incomplete: !complete, noindex: true }
    }
  } catch {
    // An expired or mistyped link shows the published page instead of an error.
  }
  return { globals: content.globals, preview: false, incomplete: false, noindex: true }
}

/** Company details for the header and footer on every page. */
export const loadCompanyInfo = createServerFn({ method: 'GET', ...loose }).handler(
  () => ({ company: companyFrom(content.globals) }),
)

/** Home: hero copy, the featured coffee, the newest journal entries and the first coffees in the shop order. */
export const loadHome = createServerFn({ method: 'GET', ...loose })
  .validator(previewInput)
  .handler(async ({ data }) => {
    const { globals, preview, incomplete, noindex } = await readGlobals(data.arecaPreview, 'homePage')
    const home = homeFrom(globals)
    return {
      home,
      featuredCoffee: content.resolve(home.featuredCoffee),
      articles: getArticles().slice(0, 3),
      coffees: getCoffees().slice(0, 3),
      preview,
      incomplete,
      noindex,
    }
  })

export const loadAbout = createServerFn({ method: 'GET', ...loose })
  .validator(previewInput)
  .handler(async ({ data }) => {
    const { globals, preview, incomplete, noindex } = await readGlobals(data.arecaPreview, 'aboutPage')
    return { about: aboutFrom(globals), preview, incomplete, noindex }
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
