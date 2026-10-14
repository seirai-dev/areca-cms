import { join } from 'node:path'
import { readContentManifest } from '@areca-cms/site-sdk/pull'
import type { PulledContentManifest } from '@areca-cms/site-sdk'
import { referenceId } from './references.ts'
import { content } from '../generated/content/areca.gen.ts'
import type { ArticlesEntry, AuthorsEntry, CoffeesEntry } from '../generated/content/areca.gen.ts'

/** Pulled content directory, as `areca.gen.ts` resolves it. Tests point ARECA_CONTENT_DIR elsewhere. */
export const CONTENT_DIR =
  process.env.ARECA_CONTENT_DIR ?? join(process.cwd(), 'src/generated/content')

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

/**
 * Newest journal entry first, by the article's date or else its publish time.
 * Each article carries its author (expanded one level, null when unset).
 */
export function getArticles() {
  return content.articles
    .all({ with: { author: true } })
    .sort((a, b) => timestamp(articleDate(b)) - timestamp(articleDate(a)))
}

export function getArticle(slug: string): ArticlesEntry | null {
  return content.articles.get(slug) ?? null
}

/** Limited lots first, then by name. */
export function getCoffees(): CoffeesEntry[] {
  return content.coffees.all().sort(
    (a, b) =>
      Number(b.data.limited) - Number(a.data.limited) ||
      a.data.name.localeCompare(b.data.name, 'en'),
  )
}

export function getCoffee(slug: string): CoffeesEntry | null {
  return content.coffees.get(slug) ?? null
}

export function getAuthors(): AuthorsEntry[] {
  return content.authors
    .all()
    .sort((a, b) => a.data.name.localeCompare(b.data.name, 'en'))
}

export function getAuthor(slug: string): AuthorsEntry | null {
  return content.authors.get(slug) ?? null
}

export function articlesByAuthor(
  authorId: string,
  articles: ArticlesEntry[] = getArticles(),
): ArticlesEntry[] {
  return articles.filter((article) => referenceId(article.data.author) === authorId)
}

export function articlesFeaturingCoffee(
  coffeeId: string,
  articles: ArticlesEntry[] = getArticles(),
): ArticlesEntry[] {
  return articles.filter((article) => referenceId(article.data.featuredCoffee) === coffeeId)
}

/** Splits the comma-separated tasting notes field into trimmed, non-empty notes. */
export function tastingNotes(coffee: CoffeesEntry): string[] {
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

function articleDate(article: ArticlesEntry): string | null {
  return article.data.publishedAt ?? article.publishedAt
}

function timestamp(raw: string | null | undefined): number {
  if (!raw) return 0
  const value = Date.parse(raw)
  return Number.isNaN(value) ? 0 : value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
