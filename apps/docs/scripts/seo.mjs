// Runs after `vite build`. Reads every prerendered page in dist/client and
// writes the files that describe the site to crawlers:
//
//   sitemap.xml  every indexable page, with lastmod when the page has one
//   robots.txt   crawl rules, a welcome for AI crawlers, the sitemap URL
//   llms.txt     a Markdown map of the site for LLMs (llmstxt.org)
//
// The pages are the source of truth, so adding, removing or renaming a page
// updates all three on the next build. It also checks each page's SEO tags
// and fails the build on errors.
//
//   node scripts/seo.mjs            write the files, print warnings
//   node scripts/seo.mjs --report   also print every page and the output
//
// Shared core: apps/landing and apps/docs keep identical copies. Site facts
// come from src/lib/seo/config.ts.
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { site } from '../src/lib/seo/config.ts'

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'meta-externalagent',
  'Amazonbot',
  'DuckAssistBot',
  'MistralAI-User',
  'cohere-ai',
]

const LIMITS = { title: [15, 60], description: [70, 160] }

// ---------------------------------------------------------------- parsing --

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function attrs(tag) {
  const out = {}
  for (const [, key, value] of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    out[key.toLowerCase()] = decode(value)
  }
  return out
}

/** Pulls the SEO-relevant parts out of one HTML page. */
export function parsePage(html) {
  const head = html.slice(0, html.indexOf('</head>') + 1 || undefined)
  const meta = {}
  for (const [tag] of head.matchAll(/<meta\s[^>]*>/g)) {
    const a = attrs(tag)
    const key = a.name ?? a.property
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content
  }
  const links = [...head.matchAll(/<link\s[^>]*>/g)].map(([tag]) => attrs(tag))
  const canonicals = links.filter((l) => l.rel === 'canonical')
  const markdown = links.find(
    (l) => l.rel === 'alternate' && l.type === 'text/markdown',
  )?.href
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/)
  const jsonLd = []
  const jsonLdErrors = []
  for (const [, body] of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      jsonLd.push(JSON.parse(decode(body)))
    } catch (error) {
      jsonLdErrors.push(error.message)
    }
  }
  const nodes = jsonLd.flatMap((doc) => doc['@graph'] ?? [doc])
  // Internal links in document order. The navigation comes first, so this
  // gives the site's own page order for llms.txt.
  const navOrder = [
    ...new Set(
      [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)]
        .map(([, href]) => decode(href).replace(site.url, '').split('#')[0])
        .filter((href) => href.startsWith('/'))
        .map((href) => href.replace(/\/$/, '') || '/'),
    ),
  ]
  return {
    title: titleMatch ? decode(titleMatch[1]).trim() : undefined,
    description: meta.description,
    robots: meta.robots ?? '',
    canonical: canonicals[0]?.href,
    canonicalCount: canonicals.length,
    markdown,
    meta,
    nodes,
    jsonLdErrors,
    navOrder,
    h1Count: (html.match(/<h1[\s>]/g) ?? []).length,
    lang: html.match(/<html[^>]*\slang="([^"]+)"/)?.[1],
  }
}

const types = (nodes) => [
  ...new Set(nodes.flatMap((n) => [n['@type']].flat()).filter(Boolean)),
]

/** Section and short name for llms.txt, from the page's breadcrumb. */
function placeInSite(page) {
  const crumbs =
    page.nodes.find((n) => n['@type'] === 'BreadcrumbList')?.itemListElement ??
    []
  const suffix = site.titleTemplate.replace('%s', '')
  const name =
    crumbs.at(-1)?.name ??
    (page.title?.endsWith(suffix) ? page.title.slice(0, -suffix.length) : page.title)
  return { section: crumbs.length >= 3 ? crumbs[1].name : undefined, name }
}

// ----------------------------------------------------------------- checks --

export function checkPages(pages) {
  const errors = []
  const warnings = []
  const seen = { title: new Map(), canonical: new Map() }

  for (const page of pages) {
    const at = (msg) => `${page.path}: ${msg}`
    if (!page.title) errors.push(at('missing <title>'))
    if (!page.description) errors.push(at('missing meta description'))
    if (!page.meta['og:image']) errors.push(at('missing og:image'))
    if (!page.lang) warnings.push(at('missing <html lang>'))
    for (const e of page.jsonLdErrors) errors.push(at(`invalid JSON-LD: ${e}`))
    if (page.canonicalCount > 1) errors.push(at('more than one canonical link'))
    if (page.h1Count !== 1 && page.indexable) {
      warnings.push(at(`${page.h1Count} <h1> elements (expected 1)`))
    }

    if (page.indexable) {
      if (!page.canonical) errors.push(at('missing canonical link'))
      else if (page.canonical !== page.url) {
        errors.push(at(`canonical ${page.canonical} should be ${page.url}`))
      }
      if (page.nodes.length === 0) errors.push(at('no JSON-LD'))
      for (const [key, value] of [
        ['title', page.title],
        ['canonical', page.canonical],
      ]) {
        if (!value) continue
        const other = seen[key].get(value)
        if (other) errors.push(at(`same ${key} as ${other}`))
        else seen[key].set(value, page.path)
      }
    }

    for (const key of ['title', 'description']) {
      const value = page[key]
      if (!value) continue
      const [min, max] = LIMITS[key]
      if (value.length < min || value.length > max) {
        warnings.push(
          at(`${key} is ${value.length} characters (aim for ${min}–${max})`),
        )
      }
    }

    const image = page.meta['og:image']
    if (image?.startsWith(site.url)) {
      const file = new URL(image).pathname
      if (!existsSync(join(page.root, file))) {
        errors.push(at(`og:image ${file} is not in the build`))
      }
    }
  }
  return { errors, warnings }
}

// ---------------------------------------------------------------- outputs --

const xml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function sitemapXml(pages) {
  const urls = pages
    .filter((p) => p.indexable)
    .map((p) => {
      const lastmod = p.meta['og:updated_time']?.slice(0, 10)
      return [
        '  <url>',
        `    <loc>${xml(p.url)}</loc>`,
        lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n')
    })
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`
}

export function robotsTxt() {
  const rules = site.robots.disallow.map((p) => `Disallow: ${p}`)
  return [
    '# Every crawler is welcome, search engines and AI assistants alike.',
    'User-agent: *',
    'Allow: /',
    ...rules,
    '',
    '# AI crawlers, named so the welcome is explicit. See /llms.txt.',
    ...AI_CRAWLERS.map((bot) => `User-agent: ${bot}`),
    'Allow: /',
    ...rules,
    '',
    `Sitemap: ${site.url}/sitemap.xml`,
    '',
  ].join('\n')
}

/**
 * Sorts a section's pages like the site's navigation: by their position in
 * the link order of the page that links to most of them (its sidebar).
 * The home page comes first; pages no one links to come last, by path.
 */
function sortLikeNav(group) {
  const paths = new Set(group.map((p) => p.path))
  let best = []
  for (const page of group) {
    const hits = page.navOrder.filter((h) => paths.has(h))
    if (hits.length > best.length) best = hits
  }
  const rank = (p) => {
    if (p.path === '/') return -1
    const i = best.indexOf(p.path)
    return i === -1 ? Infinity : i
  }
  return [...group].sort(
    (a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path),
  )
}

export function llmsTxt(pages) {
  const fallback = site.llms.fallbackSection ?? 'Pages'
  const byKey = new Map()
  for (const page of pages.filter((p) => p.indexable)) {
    const placed = placeInSite(page)
    const key = placed.section ?? fallback
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push({ ...page, name: placed.name })
  }
  const groups = new Map(
    [...byKey].map(([key, group]) => [
      key,
      sortLikeNav(group).map(
        (p) =>
          `- [${p.name}](${p.markdown ?? p.url})${p.description ? `: ${p.description}` : ''}`,
      ),
    ]),
  )
  const order = site.llms.order ?? []
  const rank = (k) => {
    const i = order.indexOf(k)
    return i === -1 ? order.length + (k === fallback ? -0.5 : 0) : i
  }
  const sections = [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([title, lines]) => `## ${title}\n\n${lines.join('\n')}`)
  for (const extra of site.llms.sections) {
    const lines = extra.links.map(
      (l) => `- [${l.title}](${l.url})${l.description ? `: ${l.description}` : ''}`,
    )
    sections.push(`## ${extra.title}\n\n${lines.join('\n')}`)
  }
  return [
    `# ${site.name}`,
    `> ${site.llms.summary}`,
    ...site.llms.details,
    ...sections,
  ].join('\n\n') + '\n'
}

// ------------------------------------------------------------------- main --

export function readBuild(root) {
  return globSync('**/*.html', { cwd: root })
    .filter((file) => file !== '404.html')
    .map((file) => {
      const path =
        '/' + file.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '')
      const clean = path.replace(/\/$/, '') || '/'
      const page = parsePage(readFileSync(join(root, file), 'utf8'))
      return {
        ...page,
        root,
        path: clean,
        url: clean === '/' ? `${site.url}/` : `${site.url}${clean}`,
        indexable: !/noindex/i.test(page.robots),
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

function main() {
  const root = join(import.meta.dirname, '..', 'dist', 'client')
  if (!existsSync(root)) {
    console.error('SEO: dist/client not found. Run `vite build` first.')
    process.exit(1)
  }
  const report = process.argv.includes('--report')
  const pages = readBuild(root)
  const { errors, warnings } = checkPages(pages)

  const files = {
    'sitemap.xml': sitemapXml(pages),
    'robots.txt': robotsTxt(),
    'llms.txt': llmsTxt(pages),
  }
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, name), body)
  }

  if (report) {
    console.log(`\nPages (${pages.length})\n`)
    for (const p of pages) {
      console.log(`${p.indexable ? '●' : '○'} ${p.path}`)
      console.log(`    title        ${p.title ?? '—'} (${p.title?.length ?? 0})`)
      console.log(
        `    description  ${p.description ?? '—'} (${p.description?.length ?? 0})`,
      )
      console.log(`    canonical    ${p.canonical ?? '—'}`)
      console.log(`    og:image     ${p.meta['og:image'] ?? '—'}`)
      console.log(`    json-ld      ${types(p.nodes).join(', ') || '—'}`)
      if (p.markdown) console.log(`    markdown     ${p.markdown}`)
    }
    console.log('\n● indexed  ○ noindex (left out of sitemap.xml and llms.txt)')
    for (const [name, body] of Object.entries(files)) {
      console.log(`\n──── ${name} ────\n${body}`)
    }
  }

  for (const w of warnings) console.warn(`SEO warning: ${w}`)
  for (const e of errors) console.error(`SEO error: ${e}`)
  const indexed = pages.filter((p) => p.indexable).length
  console.log(
    `SEO: ${indexed} indexed of ${pages.length} pages; wrote ${Object.keys(files).join(', ')}` +
      ` (${errors.length} errors, ${warnings.length} warnings)`,
  )
  if (errors.length > 0) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
