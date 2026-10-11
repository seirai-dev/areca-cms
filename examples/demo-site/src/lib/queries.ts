import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getPreviewEntry, previewHeaders } from '@areca-cms/site-sdk'
import type { PreviewResult } from '@areca-cms/site-sdk'
import { z } from 'zod'
import {
  articlesByAuthor,
  articlesFeaturingCoffee,
  authorFor,
  coffeeFor,
  getArticle,
  getArticles,
  getAuthor,
  getAuthors,
  getCoffee,
  getCoffees,
  type Article,
  type Author,
  type Coffee,
} from './content.ts'

const loose = { strict: { output: false } as const }
const slugInput = z.object({ slug: z.string().min(1) })

/** Home: the newest journal entries and the first coffees in the shop order. */
export const loadHome = createServerFn({ method: 'GET', ...loose }).handler(
  () => ({
    articles: getArticles().slice(0, 3),
    coffees: getCoffees().slice(0, 3),
  }),
)

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
      author: authorFor(article),
      coffee: coffeeFor(article),
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
  | { collection: 'articles'; entry: Article; author: Author | null; coffee: Coffee | null }
  | { collection: 'coffees'; entry: Coffee; articles: Article[] }
  | { collection: 'authors'; entry: Author; articles: Article[] }

export type PreviewLoad =
  | { ok: true; preview: PreviewData }
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
      const preview = await getPreviewEntry({ token: data.token })
      return { ok: true, preview: toPreviewData(preview) }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch preview'
      return { ok: false, error: message }
    }
  })

function toPreviewData(result: PreviewResult): PreviewData {
  switch (result.collection) {
    case 'articles': {
      const entry = result.entry as Article
      return {
        collection: 'articles',
        entry,
        author: authorFor(entry),
        coffee: coffeeFor(entry),
      }
    }
    case 'coffees': {
      const entry = result.entry as Coffee
      return {
        collection: 'coffees',
        entry,
        articles: articlesFeaturingCoffee(entry.id),
      }
    }
    case 'authors': {
      const entry = result.entry as Author
      return {
        collection: 'authors',
        entry,
        articles: articlesByAuthor(entry.id),
      }
    }
    default:
      throw new Error(`Collection "${result.collection}" is not rendered on this site.`)
  }
}
