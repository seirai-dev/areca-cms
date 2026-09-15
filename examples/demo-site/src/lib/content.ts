import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readContent } from '@areca/site-sdk/pull'
import type {
  ImageValue,
  PulledContentManifest,
  RichTextValue,
  SnapshotEntry,
} from '@areca/site-sdk'

export const CONTENT_DIR = join(process.cwd(), 'src/generated/content')

export type ArticleCategory = 'news' | 'updates'

export interface ArticleData {
  title: string
  slug: string
  excerpt?: string
  body: RichTextValue
  heroImage: ImageValue | null
  publishedAt?: string
  category?: ArticleCategory
}

export type Article = SnapshotEntry & { data: ArticleData }

export function getArticles(): Article[] {
  const articles = readContent<Article>(CONTENT_DIR, 'articles')
  return [...articles].sort(compareArticlesNewestFirst)
}

export function getArticle(slug: string): Article | undefined {
  return getArticles().find((article) => article.slug === slug)
}

export function getManifest(): PulledContentManifest {
  const filePath = join(CONTENT_DIR, 'manifest.json')
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as PulledContentManifest
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `No content manifest at ${filePath}. Run \`areca pull\` or \`pnpm content:fixture\` first.`,
      )
    }
    throw error
  }
}

export function listPrerenderPages(): Array<{ path: string }> {
  const pages = [{ path: '/' }, { path: '/blog' }]
  try {
    for (const article of getArticles()) {
      pages.push({ path: `/blog/${article.slug}` })
    }
  } catch {
    // Content is written by `areca pull` or `pnpm content:fixture` before build.
  }
  return pages
}

function compareArticlesNewestFirst(a: Article, b: Article): number {
  return articleTimestamp(b) - articleTimestamp(a)
}

function articleTimestamp(article: Article): number {
  const raw = article.data.publishedAt ?? article.publishedAt
  if (!raw) return 0
  const value = Date.parse(raw)
  return Number.isNaN(value) ? 0 : value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
