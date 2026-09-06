import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getArticle, getArticles, getManifest } from './content.ts'

const loose = { strict: { output: false } as const }

export const loadArticles = createServerFn({ method: 'GET', ...loose }).handler(
  () => getArticles(),
)

export const loadArticle = createServerFn({ method: 'GET', ...loose })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(({ data }) => getArticle(data.slug) ?? null)

export const loadManifest = createServerFn({ method: 'GET', ...loose }).handler(
  () => getManifest(),
)
