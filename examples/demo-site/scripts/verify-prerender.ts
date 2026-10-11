import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listPrerenderPages } from '../src/lib/content.ts'

const publicDir = join(process.cwd(), '.output/public')
const pages = listPrerenderPages()

if (pages.length === 0) {
  console.error('No pages to verify. Run `pnpm content:fixture` then build.')
  process.exit(1)
}

let failed = false
for (const path of pages) {
  const filePath = join(publicDir, path, 'index.html')
  if (!existsSync(filePath)) {
    console.error(`Missing prerendered page for ${path}: ${filePath}`)
    failed = true
    continue
  }
  console.log(`ok ${path} -> ${filePath}`)
}

if (failed) {
  process.exit(1)
}

console.log(`Verified ${pages.length} prerendered page(s).`)
