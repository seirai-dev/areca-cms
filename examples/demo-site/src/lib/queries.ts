import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { visualEditingHeaders } from '@areca-cms/site-sdk/visual'
import type { PreviewResult } from '@areca-cms/site-sdk'
import { z } from 'zod'
import { content } from '../generated/content/areca.gen.ts'
import type {
  ArticlesEntry,
  AuthorsEntry,
  CoffeesEntry,
} from '../generated/content/areca.gen.ts'
import { entryAlternates } from './i18n.ts'
import { LOCALES } from './locale-routes.ts'
import { publishedDataMiddleware } from './static-export.ts'
import {
  aboutData,
  companyFrom,
  homeData,
  liveAboutData,
  liveHomeData,
  readGlobals,
  setNoStoreHeaders,
  toPreviewLoad,
  withLocale,
} from './page-data.server.ts'
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
/**
 * Every published content function takes the page's language: it decides what
 * the function returns, and in the static build it keys the saved result.
 */
const localeInput = z.object({ locale: z.enum(LOCALES) })
const slugInput = localeInput.extend({ slug: z.string().min(1) })


/**
 * Search params of pages that can show a site content draft. The CMS opens
 * `<page>?arecaPreview=<token>`; anything else is ignored.
 */
export const sitePreviewSearch = z.object({
  arecaPreview: z.string().optional().catch(undefined),
})
const previewInput = localeInput.extend({ arecaPreview: z.string().optional() })


/** Company details for the header and footer on every page. */
export const loadCompanyInfo = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(localeInput)
  .handler(({ data }) => withLocale(data.locale, () => ({ company: companyFrom(content.globals) })))

/**
 * Lets the CMS frame a draft page for the visual editor: sends the visual editing
 * CSP when the CMS origin is known. Returns that origin, or null.
 */
function frameForVisualEditing(): string | null {
  const cmsOrigin = cmsOriginFrom(process.env.ARECA_CMS_URL)
  if (cmsOrigin !== null) {
    const csp = visualEditingHeaders({ cmsOrigin })
    setResponseHeader('Content-Security-Policy', csp['Content-Security-Policy'])
  }
  return cmsOrigin
}

/**
 * Input of the live site content functions: a site content result as the bridge
 * forwards it. `previewGlobals` checks the section and the entry; this only
 * checks the outer shape.
 */
const liveGlobalInput = z.looseObject({
  kind: z.literal('global'),
  global: z.string().min(1),
  entry: z.looseObject({ data: z.record(z.string(), z.unknown()) }),
})

/** Home: hero copy, the featured coffee, the newest journal entries and the first coffees in the shop order. */
export const loadHome = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(previewInput)
  .handler(({ data }) =>
    withLocale(data.locale, async () => {
      const cmsOrigin = data.arecaPreview ? frameForVisualEditing() : null
      return { ...homeData(await readGlobals(data.arecaPreview, 'homePage')), cmsOrigin }
    }),
  )

export const loadAbout = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(previewInput)
  .handler(({ data }) =>
    withLocale(data.locale, async () => {
      const cmsOrigin = data.arecaPreview ? frameForVisualEditing() : null
      return { ...aboutData(await readGlobals(data.arecaPreview, 'aboutPage')), cmsOrigin }
    }),
  )

/** The home page with an unsaved draft from the visual editor. Nothing is saved. */
export const loadLiveHome = createServerFn({ method: 'POST', ...loose })
  .validator((input: unknown) => liveGlobalInput.parse(input))
  .handler(async ({ data }) => {
    setNoStoreHeaders()
    return liveHomeData(data as unknown as PreviewResult)
  })

/** The about page with an unsaved draft from the visual editor. Nothing is saved. */
export const loadLiveAbout = createServerFn({ method: 'POST', ...loose })
  .validator((input: unknown) => liveGlobalInput.parse(input))
  .handler(async ({ data }) => {
    setNoStoreHeaders()
    return liveAboutData(data as unknown as PreviewResult)
  })

export const loadCoffees = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(localeInput)
  .handler(({ data }) => withLocale(data.locale, () => getCoffees()))

export const loadCoffee = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(slugInput)
  .handler(({ data }) =>
    withLocale(data.locale, () => {
      const coffee = getCoffee(data.slug)
      if (!coffee) return null
      return {
        coffee,
        articles: articlesFeaturingCoffee(coffee.id),
        alternates: entryAlternates(coffee.alternates),
      }
    }),
  )

export const loadJournal = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(localeInput)
  .handler(({ data }) => withLocale(data.locale, () => getArticles()))

export const loadArticle = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(slugInput)
  .handler(({ data }) =>
    withLocale(data.locale, () => {
      const article = getArticle(data.slug)
      if (!article) return null
      return {
        article,
        author: content.resolve(article.data.author),
        coffee: content.resolve(article.data.featuredCoffee),
        alternates: entryAlternates(article.alternates),
      }
    }),
  )

export const loadTeam = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(localeInput)
  .handler(({ data }) => withLocale(data.locale, () => getAuthors()))

export const loadAuthor = createServerFn({ method: 'GET', ...loose })
  .middleware(publishedDataMiddleware)
  .validator(slugInput)
  .handler(({ data }) =>
    withLocale(data.locale, () => {
      const author = getAuthor(data.slug)
      if (!author) return null
      return {
        author,
        articles: articlesByAuthor(author.id),
        alternates: entryAlternates(author.alternates),
      }
    }),
  )

export type PreviewData =
  | { collection: 'articles'; entry: ArticlesEntry; author: AuthorsEntry | null; coffee: CoffeesEntry | null }
  | { collection: 'coffees'; entry: CoffeesEntry; articles: ArticlesEntry[] }
  | { collection: 'authors'; entry: AuthorsEntry; articles: ArticlesEntry[] }

/** A complete draft renders like a published entry; an incomplete one lists what is missing. */
export type PreviewLoad =
  | { ok: true; complete: true; preview: PreviewData }
  | { ok: true; complete: false; collection: string; issues: string[] }
  | { ok: false; error: string }

/** What the preview route loads: the draft and the CMS origin the live bridge listens to. */
export type PreviewPageLoad = PreviewLoad & { cmsOrigin: string | null }

/**
 * The origin of a CMS URL, or null when it is unset, empty, not a URL or has no
 * origin (such as `file:`). Paths are dropped.
 */
export function cmsOriginFrom(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const origin = new URL(trimmed).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/**
 * Input of `loadLivePreview`: a collection entry result as the bridge forwards it.
 * Site content results are rejected here. The entry itself is checked by
 * `content.previewFrom`, which also reports incomplete drafts.
 */
export const livePreviewInput = z.looseObject({
  kind: z.literal('entry').optional(),
  collection: z.string().min(1),
  slug: z.string().min(1),
  entry: z.looseObject({
    id: z.string(),
    slug: z.string(),
    publishedAt: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
  }),
})



/**
 * Draft preview for any collection. Related entries (author, coffee, articles)
 * resolve against the local snapshot, so drafts that reference unpublished
 * entries show those references as absent. The response also lets the CMS
 * frame the page, so the visual editor can show it.
 */
export const loadPreview = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }): Promise<PreviewPageLoad> => {
    setNoStoreHeaders()
    const cmsOrigin = frameForVisualEditing()
    try {
      return { ...toPreviewLoad(await content.preview(data.token)), cmsOrigin }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch preview'
      return { ok: false, error: message, cmsOrigin }
    }
  })

/**
 * Renders an unsaved preview result from the visual editor's bridge. Nothing is
 * saved: `content.previewFrom` validates and camelises the result the CMS built.
 */
export const loadLivePreview = createServerFn({ method: 'POST', ...loose })
  .validator((input: unknown) => livePreviewInput.parse(input))
  .handler(({ data }): PreviewLoad => {
    setNoStoreHeaders()
    try {
      return toPreviewLoad(content.previewFrom(data))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to render preview'
      return { ok: false, error: message }
    }
  })

