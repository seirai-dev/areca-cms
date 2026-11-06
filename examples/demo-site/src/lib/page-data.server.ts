/**
 * Server-only helpers for the server functions in queries.ts. They read the
 * content snapshot (files on disk), so route and component modules must not
 * import this file: queries.ts only uses it inside server function handlers,
 * which the client bundle drops along with this import.
 */
import { setResponseHeader } from '@tanstack/react-start/server'
import { previewHeaders } from '@areca-cms/site-sdk'
import type { PreviewEntry, PreviewResult } from '@areca-cms/site-sdk'
import { getServerAsyncLocalStorage } from '#/paraglide/runtime'
import { content } from '../generated/content/areca.gen.ts'
import { SITE_DESCRIPTION, SITE_NAME } from './seo.ts'
import {
  articlesByAuthor,
  articlesFeaturingCoffee,
  getArticles,
  getCoffees,
} from './content.ts'
import type { Locale } from './locale-routes.ts'
import type { PreviewData, PreviewLoad } from './queries.ts'

/**
 * Runs `read` with `locale` as the request's language, so content reads in it
 * return that language. Server function requests from the browser have no
 * language prefix in their URL, so the caller passes the page's language.
 */
export function withLocale<T>(locale: Locale, read: () => T): T {
  const storage = getServerAsyncLocalStorage()
  if (!storage) throw new Error('withLocale needs the Paraglide middleware (see src/server.ts)')
  return storage.run({ ...storage.getStore(), locale }, read)
}

/**
 * Site content sections as a publication may lack them: a section with no
 * content is left out of the snapshot, so every read goes through this type.
 */
export type Sections = Partial<typeof content.globals>

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

/** The site content a page shows, and whether a draft of its section is shown. */
export type SectionView = {
  globals: Sections
  /** The page shows a draft of its section. */
  preview: boolean
  /** A draft of its section exists but is incomplete, so the published values are shown. */
  incomplete: boolean
}

/** What a site content page's server function returns besides its own data. */
export type SectionFlags = SectionView & { noindex: boolean }

/**
 * The view of a page for `section` from a preview of site content. A preview that
 * targets `section` shows its draft; when the draft is incomplete, `previewGlobals`
 * already holds the published values. A preview for another section changes nothing.
 */
export function sectionView(
  preview: { globals: Sections; previewing: string | null; complete: boolean },
  section: 'homePage' | 'aboutPage',
): SectionView {
  if (preview.previewing !== section) {
    return { globals: content.globals, preview: false, incomplete: false }
  }
  return { globals: preview.globals, preview: true, incomplete: !preview.complete }
}

/**
 * Home page data. Shared by the saved and the live preview, so both render the
 * same way.
 */
export function homeData(flags: SectionFlags) {
  const home = homeFrom(flags.globals)
  return {
    home,
    featuredCoffee: content.resolve(home.featuredCoffee),
    articles: getArticles().slice(0, 3),
    coffees: getCoffees().slice(0, 3),
    preview: flags.preview,
    incomplete: flags.incomplete,
    noindex: flags.noindex,
  }
}

/** About page data. Shared by the saved and the live preview. */
export function aboutData(flags: SectionFlags) {
  return {
    about: aboutFrom(flags.globals),
    preview: flags.preview,
    incomplete: flags.incomplete,
    noindex: flags.noindex,
  }
}

/** Home page data for an unsaved site content result from the visual editor. Nothing is saved. */
export async function liveHomeData(result: PreviewResult) {
  return homeData({ ...sectionView(await content.previewGlobals(result), 'homePage'), noindex: true })
}

/** About page data for an unsaved site content result from the visual editor. Nothing is saved. */
export async function liveAboutData(result: PreviewResult) {
  return aboutData({ ...sectionView(await content.previewGlobals(result), 'aboutPage'), noindex: true })
}

/**
 * Site content for a page that shows `section`. A token for that section
 * shows its draft (`preview: true`); when the draft is incomplete, the published
 * values stay and `incomplete: true` is set. A missing, invalid or other-section
 * token serves the published values. Any request with a token is not indexable
 * and not cacheable.
 */
export async function readGlobals(
  token: string | undefined,
  section: 'homePage' | 'aboutPage',
): Promise<SectionFlags> {
  if (!token) return { globals: content.globals, preview: false, incomplete: false, noindex: false }
  setNoStoreHeaders()
  try {
    // previewGlobals fetches the token once.
    return { ...sectionView(await content.previewGlobals(token), section), noindex: true }
  } catch {
    // An expired or mistyped link shows the published page instead of an error.
    return { globals: content.globals, preview: false, incomplete: false, noindex: true }
  }
}

export function setNoStoreHeaders(): void {
  const headers = previewHeaders()
  setResponseHeader('X-Robots-Tag', headers['X-Robots-Tag'])
  setResponseHeader('Cache-Control', headers['Cache-Control'])
}

/**
 * The preview page's data from a validated preview result. Shared by the saved
 * preview and the live one, so both render the same way.
 */
export function toPreviewLoad(result: PreviewEntry): PreviewLoad {
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
