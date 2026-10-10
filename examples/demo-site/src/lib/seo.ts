import { seoHead } from '@areca-cms/site-sdk'
import type { Article } from './content.ts'

/** Use CMS metadata, retaining a useful head for older snapshots. */
export function articleHead(article: Article | undefined) {
  if (article?.seo) return seoHead(article.seo, { titleTemplate: '%s - Acme' })
  return {
    meta: [
      { title: `${article?.data.title ?? 'Article'} - Acme` },
      ...(article?.data.excerpt
        ? [{ name: 'description', content: article.data.excerpt }]
        : []),
    ],
  }
}
