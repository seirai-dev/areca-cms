import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from './args.js'
import { run } from './cli.js'
import { createArecaClient } from './client.js'
import { pullContent, readContent, readContentManifest } from './pull.js'
import type { CollectionConfig, Snapshot, SiteManifest } from './types.js'

const IMAGE = {
  url: 'https://cdn.test/hello.jpg',
  width: 1,
  height: 1,
  alt: 'Hello',
  mimeType: 'image/jpeg',
}

const rawSchema: Record<string, CollectionConfig> = {
  'blog-posts': {
    route: '/blog/$slug',
    label: 'Blog posts',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'cover-image', label: 'Cover image', type: 'image' },
    ],
  },
  authors: {
    route: '/authors/$slug',
    label: 'Authors',
    fields: [
      { key: 'slug', label: 'Slug', type: 'slug', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
    ],
  },
}

function snapshot(
  title = 'Hello',
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    publicationId: 'pub-1',
    siteKey: 'site',
    createdAt: '2026-01-01T00:00:00.000Z',
    hash: 'h1',
    schema: rawSchema,
    collections: {
      'blog-posts': [
        {
          id: 'p1',
          slug: 'hello',
          publishedAt: null,
          data: { slug: 'hello', title, 'cover-image': IMAGE },
        },
      ],
      authors: [
        {
          id: 'a1',
          slug: 'ada',
          publishedAt: null,
          data: { slug: 'ada', name: 'Ada' },
        },
      ],
    },
    ...extra,
  }
}

const directories: string[] = []
const previousFetch = globalThis.fetch
const previousEnv = {
  url: process.env.ARECA_CMS_URL,
  token: process.env.ARECA_SITE_TOKEN,
  pin: process.env.ARECA_SNAPSHOT_ID,
}

afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  globalThis.fetch = previousFetch
  vi.restoreAllMocks()
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  restore('ARECA_CMS_URL', previousEnv.url)
  restore('ARECA_SITE_TOKEN', previousEnv.token)
  restore('ARECA_SNAPSHOT_ID', previousEnv.pin)
})

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'areca-pull-typed-'))
  directories.push(value)
  return value
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function cmsClient() {
  return createArecaClient({ cmsUrl: 'https://cms.test', siteToken: 't' })
}

/** Serves the snapshot from the CMS snapshot endpoint, with an optional manifest. */
function serve(value: Snapshot, manifest?: SiteManifest) {
  delete process.env.ARECA_SNAPSHOT_ID
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    const path = new URL(url).pathname
    if (path === '/api/sites/snapshot/current') return jsonResponse(value)
    if (path === '/api/sites/manifest' && manifest) return jsonResponse(manifest)
    return new Response('not found', { status: 404 })
  }
  return calls
}

function generationFiles(outDir: string): string[] {
  const { generation } = readContentManifest(outDir)
  return readdirSync(join(outDir, '.publications', generation!)).sort()
}

describe('pullContent with a published schema', () => {
  it('writes camelCased collection files, camel manifest keys and areca.gen.ts at the default path', async () => {
    const outDir = directory()
    serve(snapshot())
    const result = await pullContent({ outDir, client: cmsClient() })

    expect(result.warnings).toEqual([])
    expect(result.typesPath).toBe(join(outDir, 'areca.gen.ts'))
    expect(generationFiles(outDir)).toEqual(['authors.json', 'blogPosts.json'])
    expect(readContentManifest(outDir).collections).toEqual({ blogPosts: 1, authors: 1 })
    expect(readContent(outDir, 'blogPosts')).toEqual([
      {
        id: 'p1',
        slug: 'hello',
        publishedAt: null,
        collection: 'blogPosts',
        data: { slug: 'hello', title: 'Hello', coverImage: IMAGE },
      },
    ])

    const gen = readFileSync(join(outDir, 'areca.gen.ts'), 'utf8')
    expect(gen).toContain('export const schema')
    expect(gen).toContain("blogPosts: {\n    key: 'blog-posts'")
    expect(gen).toContain("export type BlogPostsEntry = Entry<'blogPosts'>")
    expect(gen).toContain(`dir: process.env.ARECA_CONTENT_DIR ?? '${outDir}'`)
  })

  it('writes the generated types to --types when given, and not to the default path', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const types = join(root, 'types', 'areca.gen.ts')
    mkdirSync(join(root, 'types'))
    serve(snapshot())
    const result = await pullContent({ outDir, types, client: cmsClient() })

    expect(result.typesPath).toBe(types)
    expect(readFileSync(types, 'utf8')).toContain('export const schema')
    expect(existsSync(join(outDir, 'areca.gen.ts'))).toBe(false)
  })

  it('keeps the previous generation and types file when validation fails', async () => {
    const outDir = directory()
    serve(snapshot('Old'))
    await pullContent({ outDir, client: cmsClient() })
    const previousManifest = readContentManifest(outDir)
    const previousTypes = readFileSync(join(outDir, 'areca.gen.ts'), 'utf8')

    const broken = snapshot('ignored')
    broken.collections['blog-posts']![0]!.data = { slug: 'hello' }
    serve(broken)
    await expect(pullContent({ outDir, client: cmsClient() })).rejects.toThrow(
      /blog-posts\/hello\.title/,
    )

    expect(readContentManifest(outDir)).toEqual(previousManifest)
    expect(readContent(outDir, 'blogPosts')[0]).toMatchObject({
      data: { title: 'Old' },
    })
    expect(readFileSync(join(outDir, 'areca.gen.ts'), 'utf8')).toBe(previousTypes)
    expect(readdirSync(join(outDir, '.publications'))).toEqual([
      previousManifest.generation,
    ])
  })

  it('writes nothing on a first pull that fails validation', async () => {
    const outDir = directory()
    const broken = snapshot()
    broken.collections['blog-posts']![0]!.data = { slug: 'hello' }
    serve(broken)
    await expect(pullContent({ outDir, client: cmsClient() })).rejects.toThrow(
      /title/,
    )
    expect(existsSync(join(outDir, 'manifest.json'))).toBe(false)
    expect(existsSync(join(outDir, '.publications'))).toBe(false)
    expect(existsSync(join(outDir, 'areca.gen.ts'))).toBe(false)
  })

  it('creates no out dir or types parent when a first pull fails validation', async () => {
    const root = directory()
    const outDir = join(root, 'nested', 'content')
    const types = join(root, 'types', 'deeper', 'areca.gen.ts')
    const broken = snapshot()
    broken.collections['blog-posts']![0]!.data = { slug: 'hello' }
    serve(broken)
    await expect(
      pullContent({ outDir, types, client: cmsClient() }),
    ).rejects.toThrow(/title/)
    expect(existsSync(join(root, 'nested'))).toBe(false)
    expect(existsSync(outDir)).toBe(false)
    expect(existsSync(join(root, 'types'))).toBe(false)
  })
})

describe('pullContent without an embedded schema', () => {
  it('falls back to GET /api/sites/manifest with the site token and warns', async () => {
    const outDir = directory()
    const calls = serve(
      snapshot('Hello', { schema: undefined }),
      { collections: rawSchema },
    )
    const result = await pullContent({ outDir, client: cmsClient() })

    expect(result.warnings).toEqual([
      'Publication pub-1 has no embedded schema; types use the current CMS schema. Go live again to embed it.',
    ])
    const manifestCall = calls.find((call) => call.url.endsWith('/api/sites/manifest'))
    expect(manifestCall).toBeDefined()
    expect(manifestCall?.init?.method ?? 'GET').toBe('GET')
    expect(new Headers(manifestCall?.init?.headers).get('Authorization')).toBe('Bearer t')
    expect(readFileSync(join(outDir, 'areca.gen.ts'), 'utf8')).toContain("key: 'blog-posts'")
    expect(readContent(outDir, 'blogPosts')[0]?.data).toMatchObject({ coverImage: IMAGE })
  })
})

describe('parseArgs --types', () => {
  it('parses pull --types with the default output directory', () => {
    expect(parseArgs(['pull', '--types', 'x/y.ts'])).toMatchObject({
      command: 'pull',
      outDir: 'src/generated/content',
      typesPath: 'x/y.ts',
    })
  })

  it('requires a value for --types', () => {
    expect(parseArgs(['pull', '--types'])).toEqual({
      command: 'error',
      message: 'Missing value for --types',
    })
  })
})

describe('areca pull --types (CLI)', () => {
  it('prints the types path after a successful pull', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const types = join(root, 'types', 'areca.gen.ts')
    mkdirSync(join(root, 'types'))
    process.env.ARECA_CMS_URL = 'https://cms.test'
    process.env.ARECA_SITE_TOKEN = 't'
    serve(snapshot())
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const code = await run(['pull', '--out', outDir, '--types', types], { cwd: root })

    expect(code).toBe(0)
    expect(log.mock.calls.flat().join('\n')).toMatch(/Types: .*areca\.gen\.ts/)
    expect(existsSync(types)).toBe(true)
  })
})

describe('pullContent with site content globals', () => {
  const ORG = '0b9e8f7a-1111-4222-8333-944455556666'
  const LOGO_ID = '3f2a91c0-aaaa-4bbb-8ccc-dddddddddddd'
  const LOGO = {
    id: `asset-${LOGO_ID}`,
    storageKey: `${ORG}/${LOGO_ID}.png`,
    url: `https://cms.test/api/assets/file/${ORG}/${LOGO_ID}.png`,
    filename: 'Logo.png',
    mimeType: 'image/png',
    size: 3,
  }

  const globalSchema: NonNullable<Snapshot['globalSchema']> = {
    'company-info': {
      label: 'Company info',
      seo: false,
      fields: [
        { key: 'email', label: 'Email', type: 'text', required: true, group: 'Contact' },
        { key: 'phone-number', label: 'Phone number', type: 'text', group: 'Contact' },
        { key: 'plan', label: 'Plan', type: 'select', options: ['basic', 'pro'] },
        {
          key: 'featured-author',
          label: 'Featured author',
          type: 'reference',
          collection: 'authors',
        },
      ],
    },
    'home-page': {
      label: 'Home page',
      seo: true,
      previewPath: '/',
      fields: [
        { key: 'hero-title', label: 'Hero title', type: 'text', required: true },
        { key: 'hero-image', label: 'Hero image', type: 'image' },
      ],
    },
  }

  function globalSnapshot(heroUrl = IMAGE.url, extra: Partial<Snapshot> = {}): Snapshot {
    return {
      ...snapshot('Hello'),
      globalSchema,
      globals: {
        'company-info': {
          id: 'g-company',
          publishedAt: '2026-01-01T00:00:00.000Z',
          data: {
            email: 'hi@acme.test',
            'phone-number': '',
            plan: 'pro',
            'featured-author': { collection: 'authors', slug: 'ada', id: 'a1' },
          },
        },
        'home-page': {
          id: 'g-home',
          publishedAt: null,
          data: {
            'hero-title': 'Welcome',
            'hero-image': { ...IMAGE, url: heroUrl },
          },
          seo: { title: 'Home' } as never,
        },
      },
      ...extra,
    }
  }

  it('writes _globals.json keyed by camel key with camelised data, and lists the globals in the manifest', async () => {
    const outDir = directory()
    serve(globalSnapshot())
    const result = await pullContent({ outDir, client: cmsClient() })

    expect(result.warnings).toEqual([])
    expect(generationFiles(outDir)).toContain('_globals.json')
    const { generation } = readContentManifest(outDir)
    const written = JSON.parse(
      readFileSync(join(outDir, '.publications', generation!, '_globals.json'), 'utf8'),
    )
    expect(written).toEqual({
      companyInfo: {
        id: 'g-company',
        publishedAt: '2026-01-01T00:00:00.000Z',
        data: {
          email: 'hi@acme.test',
          phoneNumber: '',
          plan: 'pro',
          featuredAuthor: { collection: 'authors', slug: 'ada', id: 'a1' },
        },
      },
      homePage: {
        id: 'g-home',
        publishedAt: null,
        data: { heroTitle: 'Welcome', heroImage: { ...IMAGE } },
        seo: { title: 'Home' },
      },
    })
    expect(readContentManifest(outDir).globals?.slice().sort()).toEqual(['companyInfo', 'homePage'])
    expect(readContentManifest(outDir).collections).not.toHaveProperty('companyInfo')
  })

  it('writes the generated globalSchema and passes it to createContent', async () => {
    const outDir = directory()
    serve(globalSnapshot())
    const result = await pullContent({ outDir, client: cmsClient() })

    const gen = readFileSync(result.typesPath, 'utf8')
    expect(gen).toContain('export const globalSchema = {')
    expect(gen).toContain("key: 'company-info'")
    expect(gen).toContain('export type CompanyInfoGlobal = Global<')
  })

  it('writes no _globals.json and no globals key when the snapshot has no globals', async () => {
    const outDir = directory()
    serve(snapshot())
    await pullContent({ outDir, client: cmsClient() })

    expect(generationFiles(outDir)).not.toContain('_globals.json')
    expect(readContentManifest(outDir)).not.toHaveProperty('globals')
    expect(readFileSync(join(outDir, 'areca.gen.ts'), 'utf8')).toContain(
      'export const globalSchema = {} as const',
    )
  })

  it('rejects global data that does not match its schema before writing anything', async () => {
    const outDir = directory()
    const broken = globalSnapshot()
    broken.globals!['company-info']!.data = { 'phone-number': '+31' }
    serve(broken)
    await expect(pullContent({ outDir, client: cmsClient() })).rejects.toThrow(
      /company-info[^\n]*email: is required/,
    )
    expect(existsSync(join(outDir, 'manifest.json'))).toBe(false)
  })

  it('copies media used by globals locally and points the global at the local file', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const assets = { dir: join(root, 'public/areca'), publicPath: '/areca' }
    const value = globalSnapshot(LOGO.url, { assets: [LOGO] })
    const calls: string[] = []
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      calls.push(url.pathname)
      if (url.pathname === '/api/sites/snapshot/current') return jsonResponse(value)
      if (url.pathname.startsWith('/api/assets/file/')) {
        return new Response(new Uint8Array([1, 2, 3]))
      }
      return new Response('not found', { status: 404 })
    }

    const result = await pullContent({ outDir, client: cmsClient(), assets })

    expect(result.localAssets).toMatchObject({ total: 1, downloaded: 1 })
    const { generation } = readContentManifest(outDir)
    const written = JSON.parse(
      readFileSync(join(outDir, '.publications', generation!, '_globals.json'), 'utf8'),
    )
    expect(written.homePage.data.heroImage.url).toMatch(/^\/areca\/logo-[^/]+\.png$/)
    expect(readdirSync(assets.dir)).toHaveLength(1)
  })
})
