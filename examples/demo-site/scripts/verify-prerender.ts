import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getArticles } from '../src/lib/content.ts'

const publicDir = join(process.cwd(), '.output/public')
const articles = getArticles()

if (articles.length === 0) {
  console.error('No articles in src/generated/content. Run `pnpm content:fixture` then build.')
  process.exit(1)
}

let failed = false
for (const article of articles) {
  const filePath = join(publicDir, 'blog', article.slug, 'index.html')
  if (!existsSync(filePath)) {
    console.error(`Missing prerendered article: ${filePath}`)
    failed = true
    continue
  }
  console.log(`ok ${filePath}`)
}

if (failed) {
  process.exit(1)
}

console.log(`Verified ${articles.length} prerendered article page(s).`)
