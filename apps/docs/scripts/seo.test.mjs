import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPages, llmsTxt, parsePage, sitemapXml } from './seo.mjs'

const html = (head, body = '<h1>Hi</h1>') =>
  `<html lang="en"><head>${head}</head><body>${body}</body></html>`

function page(path, head, extra = {}) {
  const parsed = parsePage(html(head))
  return {
    ...parsed,
    root: '/nonexistent',
    path,
    url: `https://docs.arecacms.com${path}`,
    indexable: !/noindex/.test(parsed.robots),
    ...extra,
  }
}

const good = (path, title) =>
  page(
    path,
    `<title>${title} · Areca CMS Docs</title>
     <meta name="description" content="A description that is long enough to pass the seventy character floor.">
     <meta property="og:image" content="https://example.com/og.png">
     <meta property="og:updated_time" content="2026-11-01T10:00:00+01:00">
     <link rel="canonical" href="https://docs.arecacms.com${path}">
     <script type="application/ld+json">{"@graph":[{"@type":"WebPage"}]}</script>`,
  )

test('parses title, meta, canonical and JSON-LD', () => {
  const p = good('/docs/a', 'Alpha')
  assert.equal(p.title, 'Alpha · Areca CMS Docs')
  assert.equal(p.canonical, 'https://docs.arecacms.com/docs/a')
  assert.deepEqual(p.nodes, [{ '@type': 'WebPage' }])
})

test('a clean page has no errors', () => {
  const { errors } = checkPages([good('/docs/a', 'Alpha page')])
  assert.deepEqual(errors, [])
})

test('flags missing tags, wrong canonicals and duplicate titles', () => {
  const bare = page('/docs/b', '<title>Bare</title>')
  const wrong = good('/docs/c', 'Same title here')
  wrong.canonical = 'https://docs.arecacms.com/docs/other'
  const dupe = good('/docs/d', 'Same title here')
  const { errors } = checkPages([bare, wrong, dupe])
  assert.ok(errors.some((e) => e.includes('/docs/b: missing meta description')))
  assert.ok(errors.some((e) => e.includes('/docs/b: missing canonical')))
  assert.ok(errors.some((e) => e.includes('/docs/c: canonical')))
  assert.ok(errors.some((e) => e.includes('/docs/d: same title as /docs/c')))
})

test('noindex pages stay out of the sitemap and llms.txt', () => {
  const hidden = page(
    '/404',
    '<title>Not found</title><meta name="robots" content="noindex, follow">',
  )
  const pages = [good('/docs/a', 'Alpha'), hidden]
  const xml = sitemapXml(pages)
  assert.match(xml, /<loc>https:\/\/docs\.arecacms\.com\/docs\/a<\/loc>/)
  assert.match(xml, /<lastmod>2026-11-01<\/lastmod>/)
  assert.doesNotMatch(xml, /404/)
  assert.doesNotMatch(llmsTxt(pages), /Not found/)
  assert.match(llmsTxt(pages), /- \[Alpha\]\(https:\/\/docs\.arecacms\.com\/docs\/a\)/)
})
