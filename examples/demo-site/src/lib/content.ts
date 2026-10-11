import { join } from 'node:path'
import { readContent, readContentManifest } from '@areca-cms/site-sdk/pull'
import type {
  ImageValue,
  PulledContentManifest,
  ReferenceValue,
  RichTextValue,
  SnapshotEntry,
} from '@areca-cms/site-sdk'

export const CONTENT_DIR = join(process.cwd(), 'src/generated/content')

export type ArticleCategory =
  | 'origin-stories'
  | 'brewing'
  | 'roastery-news'
  | 'sustainability'
export type CoffeeProcess = 'washed' | 'natural' | 'honey' | 'anaerobic'
export type RoastLevel = 'light' | 'medium' | 'medium-dark' | 'dark'

/** Fields mirror areca.config.ts. Optional CMS fields may arrive as null. */
export interface ArticleData {
  title: string
  slug: string
  excerpt: string | null
  body: RichTextValue | null
  heroImage: ImageValue | null
  category: ArticleCategory | null
  author: ReferenceValue | null
  featuredCoffee: ReferenceValue | null
  publishedAt: string | null
}

export interface CoffeeData {
  name: string
  slug: string
  origin: string
  region: string | null
  producer: string | null
  process: CoffeeProcess | null
  roastLevel: RoastLevel | null
  tastingNotes: string | null
  altitude: number | null
  /** EUR per 250 g. */
  price: number | null
  limited: boolean
  harvestDate: string | null
  image: ImageValue | null
  description: RichTextValue | null
  shopUrl: string | null
}

export interface AuthorData {
  name: string
  slug: string
  role: string | null
  bio: string | null
  portrait: ImageValue | null
}

export type Article = SnapshotEntry & { data: ArticleData }
export type Coffee = SnapshotEntry & { data: CoffeeData }
export type Author = SnapshotEntry & { data: AuthorData }

/** Captures the manifest once so every read in a call sees the same generation. */
export function getManifest(): PulledContentManifest {
  try {
    return readContentManifest(CONTENT_DIR)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `No content manifest at ${join(CONTENT_DIR, 'manifest.json')}. Run \`areca pull\` or \`pnpm content:fixture\` first.`,
      )
    }
    throw error
  }
}

/** A collection missing from the publication reads as empty, so a partial CMS still builds. */
function readCollection<T extends SnapshotEntry>(
  key: string,
  manifest: PulledContentManifest,
): T[] {
  if (!Object.hasOwn(manifest.collections ?? {}, key)) return []
  return readContent<T>(CONTENT_DIR, key, manifest)
}

export function getArticles(): Article[] {
  const manifest = getManifest()
  return readCollection<Article>('articles', manifest).sort(
    (a, b) => timestamp(articleDate(b)) - timestamp(articleDate(a)),
  )
}

export function getArticle(slug: string): Article | null {
  return getArticles().find((article) => article.slug === slug) ?? null
}

export function getCoffees(): Coffee[] {
  const manifest = getManifest()
  return readCollection<Coffee>('coffees', manifest).sort(
    (a, b) =>
      Number(b.data.limited) - Number(a.data.limited) ||
      a.data.name.localeCompare(b.data.name, 'en'),
  )
}

export function getCoffee(slug: string): Coffee | null {
  return getCoffees().find((coffee) => coffee.slug === slug) ?? null
}

export function getAuthors(): Author[] {
  const manifest = getManifest()
  return readCollection<Author>('authors', manifest).sort((a, b) =>
    a.data.name.localeCompare(b.data.name, 'en'),
  )
}

export function getAuthor(slug: string): Author | null {
  return getAuthors().find((author) => author.slug === slug) ?? null
}

/** Resolves an article's author reference by id. */
export function authorFor(
  article: Article,
  authors: Author[] = getAuthors(),
): Author | null {
  const id = article.data.author?.id
  if (!id) return null
  return authors.find((author) => author.id === id) ?? null
}

/** Resolves an article's featured coffee reference by id. */
export function coffeeFor(
  article: Article,
  coffees: Coffee[] = getCoffees(),
): Coffee | null {
  const id = article.data.featuredCoffee?.id
  if (!id) return null
  return coffees.find((coffee) => coffee.id === id) ?? null
}

export function articlesByAuthor(
  authorId: string,
  articles: Article[] = getArticles(),
): Article[] {
  return articles.filter((article) => article.data.author?.id === authorId)
}

export function articlesFeaturingCoffee(
  coffeeId: string,
  articles: Article[] = getArticles(),
): Article[] {
  return articles.filter(
    (article) => article.data.featuredCoffee?.id === coffeeId,
  )
}

/** Splits the comma-separated tasting notes field into trimmed, non-empty notes. */
export function tastingNotes(coffee: Coffee): string[] {
  return (coffee.data.tastingNotes ?? '')
    .split(',')
    .map((note) => note.trim())
    .filter(Boolean)
}

/** Every route the static build must prerender. */
export function listPrerenderPages(): string[] {
  const pages = ['/', '/coffees', '/journal', '/team', '/about']
  for (const coffee of getCoffees()) pages.push(`/coffees/${coffee.slug}`)
  for (const article of getArticles()) pages.push(`/journal/${article.slug}`)
  for (const author of getAuthors()) pages.push(`/team/${author.slug}`)
  return pages
}

function articleDate(article: Article): string | null {
  return article.data.publishedAt ?? article.publishedAt
}

function timestamp(raw: string | null): number {
  if (!raw) return 0
  const value = Date.parse(raw)
  return Number.isNaN(value) ? 0 : value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
