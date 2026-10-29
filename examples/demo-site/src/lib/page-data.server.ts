/**
 * Server-only helpers for the server functions in queries.ts. They read the
 * content snapshot (files on disk), so route and component modules must not
 * import this file: queries.ts only uses it inside server function handlers,
 * which the client bundle drops along with this import.
 */
import { setResponseHeader } from '@tanstack/react-start/server'
import { previewHeaders } from '@areca-cms/site-sdk'
import type { PreviewEntry } from '@areca-cms/site-sdk'
import { content } from '../generated/content/areca.gen.ts'
import { SITE_DESCRIPTION, SITE_NAME } from './seo.ts'
import { articlesByAuthor, articlesFeaturingCoffee } from './content.ts'
import type { PreviewData, PreviewLoad } from './queries.ts'

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
