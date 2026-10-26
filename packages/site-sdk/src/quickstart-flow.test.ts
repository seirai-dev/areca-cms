import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { run } from './cli.js'
import type { PulledContentManifest, SiteManifest, Snapshot } from './types.js'

/*
 * Scenario test for the `areca-quickstart` agent skill: the command sequence
 * an agent runs on a brand-new site project, against a fake CMS served over
 * a real local HTTP socket. Steps share state, so they run in order.
 */

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE_KEY = 'quickstart-test'
const TOKEN = 'quickstart-token'
const OUT_DIR = 'src/generated/content'
const CONFIG = 'areca.config.ts'

const ENV_KEYS = ['ARECA_CMS_URL', 'ARECA_SITE_TOKEN', 'ARECA_SNAPSHOT_ID', 'ARECA_CONTENT_DIR']
const savedEnv: Record<string, string | undefined> = {}

/* ---------- fake CMS fixtures ---------- */

/** What the CMS serves from GET /api/sites/manifest after the agent has modelled the site over MCP. */
const manifest: SiteManifest = {
  languages: { main: 'en', all: ['en', 'nl'] },
  collections: {
    posts: {
      route: '/blog/$slug',
      label: 'Posts',
      fields: [
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
        { key: 'body', label: 'Body', type: 'richtext' },
        { key: 'coverImage', label: 'Cover image', type: 'image' },
        { key: 'publishedAt', label: 'Published at', type: 'datetime' },
        { key: 'category', label: 'Category', type: 'reference', collection: 'categories' },
      ],
    },
    categories: {
      route: '/blog/category/$slug',
      label: 'Categories',
      fields: [
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'name', label: 'Name', type: 'text', required: true },
      ],
    },
    vacancies: {
      route: '/vacancies/$slug',
      label: 'Vacancies',
      routes: { nl: '/nl/vacatures/$slug' },
      fields: [
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'location', label: 'Location', type: 'text' },
        {
          key: 'employmentType',
          label: 'Employment type',
          type: 'select',
          options: ['full-time', 'part-time', 'freelance'],
        },
        { key: 'hoursPerWeek', label: 'Hours per week', type: 'number' },
        { key: 'closingDate', label: 'Closing date', type: 'date' },
        { key: 'applyUrl', label: 'Apply URL', type: 'url' },
        { key: 'description', label: 'Description', type: 'richtext' },
      ],
    },
  },
  globals: {
    companyInfo: {
      label: 'Company info',
      seo: false,
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'text' },
      ],
    },
  },
}

const IMAGE = {
  url: 'https://cdn.test/cover.jpg',
  width: 1200,
  height: 630,
  alt: 'Cover',
  mimeType: 'image/jpeg',
}

function richText(text: string) {
  return {
    json: { type: 'doc' },
    markdown: text,
    document: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
    },
    html: `<p>${text}</p>`,
  }
}

/** One sample entry per collection plus the companyInfo global, as a go-live embeds them. */
function publication(): Snapshot {
  return {
    publicationId: 'pub-quickstart',
    siteKey: SITE_KEY,
    createdAt: '2026-10-26T10:00:00.000Z',
    hash: 'hash-quickstart',
    languages: { main: 'en', all: ['en', 'nl'] },
    assets: [],
    schema: manifest.collections,
    collections: {
      posts: [
        {
          id: 'post-1',
          slug: 'hello-world',
          publishedAt: '2026-10-26T09:00:00.000Z',
          data: {
            slug: 'hello-world',
            title: 'Hello world',
            excerpt: 'Our first post',
            body: richText('Hello from the quickstart'),
            coverImage: IMAGE,
            publishedAt: '2026-10-26T09:00:00.000Z',
            category: { collection: 'categories', slug: 'news', id: 'cat-1' },
          },
        },
      ],
      categories: [
        {
          id: 'cat-1',
          slug: 'news',
          publishedAt: '2026-10-26T09:00:00.000Z',
          data: { slug: 'news', name: 'News' },
        },
      ],
      vacancies: [
        {
          id: 'vac-1',
          slug: 'frontend-developer',
          publishedAt: '2026-10-26T09:00:00.000Z',
          data: {
            slug: 'frontend-developer',
            title: 'Frontend developer',
            location: 'Amsterdam',
            employmentType: 'full-time',
            hoursPerWeek: 36,
            closingDate: '2026-12-01',
            applyUrl: 'https://jobs.example.test/apply',
            description: richText('Build the site'),
          },
        },
      ],
    },
    globals: {
      companyInfo: {
        id: 'g-company',
        publishedAt: '2026-10-26T09:00:00.000Z',
        data: { name: 'Northbound', email: 'hello@northbound.example' },
      },
    },
    globalSchema: { companyInfo: manifest.globals!.companyInfo! },
  }
}

/* ---------- fake CMS server ---------- */

type FakeCms = {
  url: string
  /** Manifest GET requests, with the Authorization header each one carried. */
  manifestAuth: string[]
  /** The response to GET /api/sites/snapshot/current. `null` means no publication exists yet. */
  publication: Snapshot | null
  close: () => Promise<void>
}

async function startFakeCms(): Promise<FakeCms> {
  const cms: FakeCms = {
    url: '',
    manifestAuth: [],
    publication: null,
    close: async () => {},
  }
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://cms.test').pathname
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET' && path === '/api/sites/manifest') {
      const auth = req.headers.authorization ?? ''
      cms.manifestAuth.push(auth)
      if (auth !== `Bearer ${TOKEN}`) return send(401, { error: 'Unauthorized' })
      return send(200, manifest)
    }
    if (req.method === 'GET' && path === '/api/sites/snapshot/current') {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        return send(401, { error: 'Unauthorized' })
      }
      if (cms.publication === null) return send(404, { error: 'No publication exists' })
      return send(200, cms.publication)
    }
    send(404, { error: 'Not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('no address')
  cms.url = `http://127.0.0.1:${address.port}`
  cms.close = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  return cms
}

/* ---------- helpers ---------- */

let cms: FakeCms
let dir: string
let log: ReturnType<typeof vi.spyOn>
let errorLog: ReturnType<typeof vi.spyOn>
let warnLog: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  // The temp project imports the SDK through its package exports, which point at dist/.
  // CI and prepack run tests before the build, so compile dist/ here when it is missing.
  if (!existsSync(join(packageDir, 'dist', 'index.js'))) {
    const tsc = spawnSync(process.execPath, [join(packageDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
      cwd: packageDir,
      encoding: 'utf8',
    })
    if (tsc.status !== 0) throw new Error(`Building dist/ for the quickstart scenario failed:\n${tsc.stdout}${tsc.stderr}`)
  }
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  cms = await startFakeCms()
})

afterAll(async () => {
  await cms.close()
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  if (dir) rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function silence() {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {})
}

function read(path: string): string {
  return readFileSync(join(dir, path), 'utf8')
}

function readJson<T = unknown>(path: string): T {
  return JSON.parse(read(path)) as T
}

function packageScripts(): Record<string, string> {
  return (readJson<{ scripts: Record<string, string> }>('package.json')).scripts
}

/** The exact flags the skill passes to `areca init`. */
function initArgv(): string[] {
  return ['init', '--yes', '--cms-url', cms.url, '--token', TOKEN, '--site-key', SITE_KEY]
}

function generationDir(): string {
  const manifestJson = readJson<PulledContentManifest>(`${OUT_DIR}/manifest.json`)
  if (!manifestJson.generation) throw new Error('manifest has no generation')
  return join(dir, OUT_DIR, '.publications', manifestJson.generation)
}

describe('areca-quickstart: brand-new site project', () => {
  it('step 1: starts from a bare project with a dev script and no areca files', () => {
    dir = mkdtempSync(join(tmpdir(), 'areca-quickstart-'))
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'new-site', private: true, scripts: { dev: 'vite' } }, null, 2)}\n`,
      'utf8',
    )
    expect(existsSync(join(dir, CONFIG))).toBe(false)
    expect(existsSync(join(dir, '.env.local'))).toBe(false)
  })

  it('step 2: areca init --yes writes config, env files, gitignore and scripts', async () => {
    silence()
    expect(await run(initArgv(), { cwd: dir })).toBe(0)

    expect(read(CONFIG)).toBe(
      `import { defineSiteContent } from '@areca-cms/site-sdk'\n\nexport default defineSiteContent({\n  siteKey: '${SITE_KEY}',\n  assets: {\n    download: true,\n    dir: 'public/areca',\n  },\n  collections: {},\n})\n`,
    )
    expect(read('.env.local')).toBe(
      `ARECA_CMS_URL=${cms.url}\nARECA_SITE_TOKEN=${TOKEN}\n`,
    )
    expect(read('.env.example')).toBe(
      `ARECA_CMS_URL=${cms.url}\nARECA_SITE_TOKEN=\nARECA_SCHEMA_TOKEN=\n`,
    )
    const gitignore = read('.gitignore').split('\n')
    expect(gitignore).toEqual(
      expect.arrayContaining([
        '.env.local',
        'src/generated/content/*',
        '!src/generated/content/areca.gen.ts',
        'public/areca/',
      ]),
    )

    const scripts = packageScripts()
    expect(scripts['content:pull']).toBe('areca pull --out src/generated/content')
    expect(scripts['sync-manifest']).toBe('areca manifest push')
    expect(scripts.dev).toBe('areca run -- vite')

    // Empty generated output is ignored, areca.gen.ts is committed.
    expect(readJson(`${OUT_DIR}/manifest.json`)).toEqual({
      publicationId: '',
      hash: '',
      createdAt: '',
      collections: {},
    })
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const ignored = (file: string) =>
      spawnSync('git', ['check-ignore', '-q', file], { cwd: dir }).status === 0
    expect(ignored(`${OUT_DIR}/manifest.json`)).toBe(true)
    expect(ignored(`${OUT_DIR}/areca.gen.ts`)).toBe(false)
    expect(ignored('.env.local')).toBe(true)

    // Once the SDK is installed, the config and generated code can resolve it.
    mkdirSync(join(dir, 'node_modules', '@areca-cms'), { recursive: true })
    symlinkSync(packageDir, join(dir, 'node_modules', '@areca-cms', 'site-sdk'), 'dir')
  })

  it('step 3: the agent adds content:sync, and a re-run of init keeps it and the dev wrapper', async () => {
    const pkg = readJson<{ scripts: Record<string, string> }>('package.json')
    pkg.scripts['content:sync'] = 'areca manifest pull && areca pull --out src/generated/content'
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

    silence()
    expect(await run(initArgv(), { cwd: dir })).toBe(0)

    const scripts = packageScripts()
    expect(scripts['content:sync']).toBe(
      'areca manifest pull && areca pull --out src/generated/content',
    )
    expect(scripts.dev).toBe('areca run -- vite')
    expect(read(CONFIG)).toContain(`siteKey: '${SITE_KEY}'`)
    expect(read(CONFIG)).toContain('collections: {},')
  })

  it('step 4: manifest pull writes collections, globals and languages into areca.config.ts', async () => {
    silence()
    expect(await run(['manifest', 'pull', '--yes'], { cwd: dir })).toBe(0)
    expect(cms.manifestAuth.at(-1)).toBe(`Bearer ${TOKEN}`)

    const config = read(CONFIG)
    // Local settings survive the re-render.
    expect(config).toContain(`siteKey: '${SITE_KEY}'`)
    expect(config).toContain("    download: true,\n    dir: 'public/areca',")
    // Languages come from the CMS.
    expect(config).toContain("languages: { main: 'en', all: ['en', 'nl'] },")
    // Collections and the global come from the CMS, with their routes and field options.
    expect(config).toContain("posts: {\n      route: '/blog/$slug',")
    expect(config).toContain("categories: {\n      route: '/blog/category/$slug',")
    expect(config).toContain("vacancies: {\n      route: '/vacancies/$slug',")
    expect(config).toContain("nl: '/nl/vacatures/$slug'")
    expect(config).toContain("key: 'employmentType',")
    expect(config).toContain("options: ['full-time', 'part-time', 'freelance'],")
    expect(config).toContain("collection: 'categories',")
    expect(config).toContain('globals: {')
    expect(config).toContain("companyInfo: {\n      label: 'Company info',")

    // A second pull without --yes finds nothing to change: no prompt, no write.
    const generated = read(CONFIG)
    log.mockClear()
    expect(await run(['manifest', 'pull'], { cwd: dir })).toBe(0)
    expect(read(CONFIG)).toBe(generated)
    expect(log.mock.calls.flat().map(String)).toEqual([expect.stringMatching(/areca\.config\.ts is already up to date$/)])

    // Each run of the skill's re-run mode keeps what the agent added.
    const pkg = packageScripts()
    expect(pkg['content:sync']).toBeDefined()
  })

  it('step 4b: re-running init after the manifest pull does not clobber the config or scripts', async () => {
    const before = read(CONFIG)
    silence()
    expect(await run(initArgv(), { cwd: dir })).toBe(0)
    expect(read(CONFIG)).toBe(before)
    expect(packageScripts()['content:sync']).toBe(
      'areca manifest pull && areca pull --out src/generated/content',
    )
    expect(packageScripts().dev).toBe('areca run -- vite')
  })

  it('step 5: pull before any release fails with no publication and writes nothing', async () => {
    cms.publication = null
    silence()
    expect(await run(['pull', '--out', OUT_DIR], { cwd: dir })).toBe(1)
    const messages = errorLog.mock.calls.flat().join('\n')
    expect(messages).toContain('No publication exists')
    expect(existsSync(join(dir, OUT_DIR, 'areca.gen.ts'))).toBe(false)
    expect(existsSync(join(dir, OUT_DIR, '.publications'))).toBe(false)
    // The empty manifest from init is untouched.
    expect(readJson(`${OUT_DIR}/manifest.json`)).toEqual({
      publicationId: '',
      hash: '',
      createdAt: '',
      collections: {},
    })
  })

  it('step 6: after go live, pull writes manifest, types and camelCase entries', async () => {
    cms.publication = publication()
    silence()
    expect(await run(['pull', '--out', OUT_DIR], { cwd: dir })).toBe(0)

    const pulled = readJson<PulledContentManifest>(`${OUT_DIR}/manifest.json`)
    expect(pulled.publicationId).toBe('pub-quickstart')
    expect(pulled.collections).toEqual({ categories: 1, posts: 1, vacancies: 1 })
    expect(pulled.globals).toEqual(['companyInfo'])
    expect(pulled.languages).toEqual({ main: 'en', all: ['en', 'nl'] })

    const types = read(`${OUT_DIR}/areca.gen.ts`)
    expect(types).toContain('export const content = createContent({')
    expect(types).toContain('interface Register')

    const gen = generationDir()
    const readGen = (file: string) => JSON.parse(readFileSync(join(gen, file), 'utf8')) as unknown
    expect(readGen('posts.json')).toEqual([
      expect.objectContaining({
        slug: 'hello-world',
        collection: 'posts',
        data: expect.objectContaining({ coverImage: IMAGE }),
      }),
    ])
    expect(readGen('vacancies.json')).toEqual([
      expect.objectContaining({
        slug: 'frontend-developer',
        collection: 'vacancies',
        data: expect.objectContaining({ employmentType: 'full-time', hoursPerWeek: 36 }),
      }),
    ])
    expect(readGen('categories.json')).toEqual([
      expect.objectContaining({ slug: 'news', collection: 'categories' }),
    ])
    expect(readGen('_globals.json')).toEqual({
      companyInfo: expect.objectContaining({
        data: expect.objectContaining({ name: 'Northbound' }),
      }),
    })
    expect(log.mock.calls.flat().join('\n')).toContain('Pulled publication pub-quickstart')
    expect(warnLog).not.toHaveBeenCalled()
  })

  it('step 7: the generated content compiles in an app with zero diagnostics', () => {
    const app = `import { content } from './${OUT_DIR}/areca.gen.js'

const posts = content.posts.all()
const title: string = posts[0].data.title
const category = content.resolve(posts[0].data.category)
const name: string | undefined = category?.data.name

const vacancy = content.vacancies.get('frontend-developer')
// Select fields are typed raw: the empty string and null stay in the union.
const type: 'full-time' | 'part-time' | 'freelance' | '' | null | undefined = vacancy?.data.employmentType
const info = content.globals.companyInfo
const company: string = info.name

// @ts-expect-error camelCase collection keys only
content.blog_posts
// @ts-expect-error select options are a closed set
content.vacancies.all({ where: { employmentType: 'contract' } })
`
    writeFileSync(join(dir, 'app.ts'), app, 'utf8')
    const output = compileDiagnostics([join(dir, 'app.ts'), join(dir, OUT_DIR, 'areca.gen.ts')], dir)
    if (output !== '') console.error(output)
    expect(output).toBe('')
  }, 60_000)

  it('step 8: the generated content reads the pulled publication at runtime', async () => {
    process.env.ARECA_CONTENT_DIR = join(dir, OUT_DIR)
    const { content } = (await import(
      pathToFileURL(join(dir, OUT_DIR, 'areca.gen.ts')).href
    )) as { content: Record<string, any> }

    const posts = content.posts.all()
    expect(posts).toHaveLength(1)
    expect(posts[0].data.title).toBe('Hello world')
    expect(content.posts.get('hello-world').data.coverImage).toEqual(IMAGE)
    expect(content.resolve(posts[0].data.category).data.name).toBe('News')

    const vacancy = content.vacancies.get('frontend-developer')
    expect(vacancy.data).toMatchObject({
      title: 'Frontend developer',
      employmentType: 'full-time',
      hoursPerWeek: 36,
    })
    expect(content.vacancies.get('missing-role')).toBeUndefined()
    expect(content.globals.companyInfo.name).toBe('Northbound')
  })
})

/** Compiles the root files against the real SDK sources and returns the formatted diagnostics. */
function compileDiagnostics(rootNames: string[], cwd: string): string {
  const sdkSrc = join(packageDir, 'src')
  const program = ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      verbatimModuleSyntax: true,
      types: ['node'],
      typeRoots: [join(packageDir, 'node_modules', '@types')],
      paths: {
        '@areca-cms/site-sdk': [join(sdkSrc, 'index.ts')],
        '@areca-cms/site-sdk/content': [join(sdkSrc, 'content.ts')],
      },
    },
  })
  return ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => cwd,
    getNewLine: () => '\n',
  })
}
