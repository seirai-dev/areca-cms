// Runs after `vite build`. The prerender step already fails on links to
// missing pages; this also fails on links to missing #headings.
import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'dist', 'client')
const pages = new Map()

for (const file of globSync('**/index.html', { cwd: root })) {
  const path = '/' + file.replace(/(^|\/)index\.html$/, '')
  pages.set(path.replace(/\/$/, '') || '/', readFileSync(join(root, file), 'utf8'))
}

const ids = new Map(
  [...pages].map(([path, html]) => [
    path,
    new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])),
  ]),
)

const broken = []
let checked = 0
for (const [path, html] of pages) {
  for (const [, href] of html.matchAll(/href="([^"]*#[^"]+)"/g)) {
    if (/^[a-z]+:/i.test(href)) continue
    const [target, hash] = href.split('#')
    const targetPath = (target || path).replace(/\/$/, '') || '/'
    const anchors = ids.get(targetPath)
    if (anchors) checked++
    if (anchors && !anchors.has(decodeURIComponent(hash))) {
      broken.push(`${path} -> ${href}`)
    }
  }
}

if (broken.length > 0) {
  console.error(`Broken anchor links:\n  ${[...new Set(broken)].join('\n  ')}`)
  process.exit(1)
}
console.log(`Anchor links OK (${checked} links across ${pages.size} pages)`)
