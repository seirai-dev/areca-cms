import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from './args.js'
import { run } from './cli.js'
import { createArecaClient } from './client.js'
import { defineSiteContent, manifestFromConfig } from './config.js'
import { getPreviewEntry, previewHeaders } from './preview.js'
import { pullContent, readContent } from './pull.js'
import {
  richTextDocument,
  richTextHtml,
  richTextMarkdown,
} from './rich-text.js'
import type {
  RichTextValue,
  SiteContentConfig,
  Snapshot,
  SnapshotEntry,
} from './types.js'

const sampleConfig: SiteContentConfig = {
  siteKey: 'demo',
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'body', label: 'Body', type: 'richtext' },
      ],
    },
    pages: {
      route: '/$slug',
      fields: [{ key: 'title', label: 'Title', type: 'text' }],
    },
  },
}

const sampleEntry: SnapshotEntry = {
  id: 'ent_1',
  slug: 'hello',
  publishedAt: '2026-01-02T00:00:00.000Z',
  data: {
    title: 'Hello',
    body: {
      json: { type: 'doc' },
      markdown: 'Hi',
      document: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'Hi' }] },
        ],
      },
      html: '<p>Hi</p>',
    },
  },
}

const sampleSnapshot: Snapshot = {
  publicationId: 'pub_1',
  siteKey: 'demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  hash: 'abc123',
  collections: {
    articles: [sampleEntry],
    pages: [],
  },
}

const originalFetch = globalThis.fetch
const originalUrl = process.env.ARECA_CMS_URL
const originalToken = process.env.ARECA_SITE_TOKEN

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.ARECA_CMS_URL
  else process.env.ARECA_CMS_URL = originalUrl
  if (originalToken === undefined) delete process.env.ARECA_SITE_TOKEN
  else process.env.ARECA_SITE_TOKEN = originalToken
})

describe('defineSiteContent', () => {
  it('returns the config as-is', () => {
    expect(defineSiteContent(sampleConfig)).toBe(sampleConfig)
  })
})

describe('manifestFromConfig', () => {
  it('returns the collections payload without siteKey', () => {
    expect(manifestFromConfig(sampleConfig)).toEqual({
      collections: {
        articles: {
          route: '/blog/$slug',
          label: 'Articles',
          fields: sampleConfig.collections.articles.fields,
        },
        pages: {
          route: '/$slug',
          fields: sampleConfig.collections.pages.fields,
        },
      },
    })
  })
})

describe('createArecaClient', () => {
  it('throws a clear error when env vars are missing', () => {
    delete process.env.ARECA_CMS_URL
    delete process.env.ARECA_SITE_TOKEN

    expect(() => createArecaClient()).toThrow(/ARECA_CMS_URL/)
    expect(() =>
      createArecaClient({ cmsUrl: 'https://cms.example.com' }),
    ).toThrow(/ARECA_SITE_TOKEN/)
  })

  it('syncManifest posts the manifest with a bearer token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse({ ok: true })
    }

    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com/',
      siteToken: 'site-token',
      schemaToken: 'schema-token',
    })
    await expect(client.syncManifest(sampleConfig)).resolves.toEqual({
      ok: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://cms.example.com/api/sites/manifest')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(authHeader(calls[0]?.init)).toBe('Bearer schema-token')
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify(manifestFromConfig(sampleConfig)),
    )
  })

  it('fetchManifest GETs the manifest with a bearer token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse(manifestFromConfig(sampleConfig))
    }

    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com',
      siteToken: 'site-token',
    })
    await expect(client.fetchManifest()).resolves.toEqual(
      manifestFromConfig(sampleConfig),
    )
    expect(calls[0]?.url).toBe('https://cms.example.com/api/sites/manifest')
    expect(calls[0]?.init?.method).toBe('GET')
    expect(authHeader(calls[0]?.init)).toBe('Bearer site-token')
  })

  it('fetchManifest throws on 401', async () => {
    globalThis.fetch = async () =>
      jsonResponse({ error: 'Invalid site token' }, 401)
    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com',
      siteToken: 'bad',
    })
    await expect(client.fetchManifest()).rejects.toThrow(
      /Failed to fetch manifest \(401\): Invalid site token/,
    )
  })

  it('fetchSnapshot returns the snapshot', async () => {
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe(
        'https://cms.example.com/api/sites/snapshot/current',
      )
      return jsonResponse(sampleSnapshot)
    }

    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com',
      siteToken: 'site-token',
    })
    await expect(client.fetchSnapshot()).resolves.toEqual(sampleSnapshot)
  })

  it('fetchSnapshot throws when no publication exists', async () => {
    globalThis.fetch = async () =>
      jsonResponse({ error: 'No live publication' }, 404)

    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com',
      siteToken: 'site-token',
    })
    await expect(client.fetchSnapshot()).rejects.toThrow(
      /No publication exists/,
    )
  })

  it('fetchSnapshot throws a clear error when the CMS is unreachable', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }

    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com',
      siteToken: 'site-token',
    })
    await expect(client.fetchSnapshot()).rejects.toThrow(
      /Failed to reach CMS at https:\/\/cms.example.com.*areca pull/,
    )
  })

  it('fetchPreview requests the token query and returns the entry', async () => {
    const preview = {
      collection: 'articles',
      slug: 'hello',
      entry: sampleEntry,
    }
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe(
        'https://cms.example.com/api/sites/preview?token=opaque-token',
      )
      return jsonResponse(preview)
    }

    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com',
      siteToken: 'site-token',
    })
    await expect(client.fetchPreview('opaque-token')).resolves.toEqual(preview)
  })

  it('fetchPreview throws on 401', async () => {
    globalThis.fetch = async () => jsonResponse({ error: 'Invalid token' }, 401)

    const client = createArecaClient({
      cmsUrl: 'https://cms.example.com',
      siteToken: 'site-token',
    })
    await expect(client.fetchPreview('bad')).rejects.toThrow(/Invalid token/)
  })

  it('reads cmsUrl and siteToken from the environment', async () => {
    process.env.ARECA_CMS_URL = 'https://env.example.com'
    process.env.ARECA_SITE_TOKEN = 'env-token'

    let auth: string | null = null
    globalThis.fetch = async (_input, init) => {
      auth = authHeader(init)
      return jsonResponse(sampleSnapshot)
    }

    await createArecaClient().fetchSnapshot()
    expect(auth).toBe('Bearer env-token')
  })
})

describe('pullContent / readContent', () => {
  it('writes manifest.json and per-collection files, then reads them back', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'areca-site-sdk-'))
    try {
      globalThis.fetch = async () => jsonResponse(sampleSnapshot)

      const snapshot = await pullContent({
        outDir,
        client: createArecaClient({
          cmsUrl: 'https://cms.example.com',
          siteToken: 't',
        }),
      })
      expect(snapshot).toEqual({ ...sampleSnapshot, warnings: [] })

      const manifest = JSON.parse(
        readFileSync(join(outDir, 'manifest.json'), 'utf8'),
      )
      expect(manifest).toMatchObject({
        publicationId: 'pub_1',
        hash: 'abc123',
        createdAt: '2026-01-01T00:00:00.000Z',
        collections: { articles: 1, pages: 0 },
      })
      expect(manifest.generation).toMatch(/^publication-/)

      expect(readContent(outDir, 'articles')).toEqual([sampleEntry])
      expect(readContent(outDir, 'pages')).toEqual([])
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('readContent throws a clear error when the output directory is missing', () => {
    const outDir = join(tmpdir(), 'areca-site-sdk-does-not-exist')
    expect(() => readContent(outDir, 'articles')).toThrow(/areca pull/)
  })

  it('readContent throws a clear error when the collection file is missing', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'areca-site-sdk-'))
    try {
      expect(() => readContent(outDir, 'articles')).toThrow(/areca pull/)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})

describe('preview helpers', () => {
  it('previewHeaders disable indexing and caching', () => {
    expect(previewHeaders()).toEqual({
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    })
  })

  it('getPreviewEntry delegates to the client', async () => {
    const preview = {
      collection: 'articles',
      slug: 'hello',
      entry: sampleEntry,
    }
    const fetchPreview = vi.fn().mockResolvedValue(preview)

    await expect(
      getPreviewEntry({
        token: 'opaque',
        client: {
          syncManifest: vi.fn(),
          fetchManifest: vi.fn(),
          fetchSnapshot: vi.fn(),
          fetchPreview,
        },
      }),
    ).resolves.toEqual(preview)
    expect(fetchPreview).toHaveBeenCalledWith('opaque')
  })
})

describe('rich text accessors', () => {
  const body = sampleEntry.data.body as RichTextValue

  it('returns the document, markdown and html', () => {
    expect(richTextDocument(body)).toBe(body.document)
    expect(richTextMarkdown(body)).toBe('Hi')
    expect(richTextHtml(body)).toBe('<p>Hi</p>')
  })

  it('parses markdown when a snapshot predates the document field', () => {
    const legacy = {
      json: null,
      markdown: '## Old\n\nBody',
      html: '',
    } as unknown as RichTextValue
    expect(richTextDocument(legacy).children.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
    ])
  })

  it('returns empty values for missing rich text', () => {
    expect(richTextDocument(null)).toEqual({ type: 'root', children: [] })
    expect(richTextDocument(undefined)).toEqual({ type: 'root', children: [] })
    expect(richTextMarkdown(null)).toBe('')
    expect(richTextHtml(null)).toBe('')
    expect(richTextHtml(undefined)).toBe('')
  })
})

describe('parseArgs', () => {
  it('defaults pull output to src/generated/content', () => {
    expect(parseArgs(['pull'])).toEqual({
      command: 'pull',
      outDir: 'src/generated/content',
    })
  })

  it('parses --out for pull', () => {
    expect(parseArgs(['pull', '--out', 'tmp/content'])).toEqual({
      command: 'pull',
      outDir: 'tmp/content',
    })
  })

  it('requires a value for --out', () => {
    expect(parseArgs(['pull', '--out'])).toEqual({
      command: 'error',
      message: 'Missing value for --out',
    })
  })

  it('parses sync-manifest', () => {
    expect(parseArgs(['sync-manifest', './areca.config.ts'])).toEqual({
      command: 'sync-manifest',
      configPath: './areca.config.ts',
    })
  })

  it('defaults sync-manifest path to ./areca.config.ts', () => {
    expect(parseArgs(['sync-manifest'])).toEqual({
      command: 'sync-manifest',
      configPath: './areca.config.ts',
    })
  })

  it('parses manifest push like sync-manifest', () => {
    expect(parseArgs(['manifest', 'push'])).toEqual({
      command: 'sync-manifest',
      configPath: './areca.config.ts',
    })
    expect(parseArgs(['manifest', 'push', './custom.config.ts'])).toEqual({
      command: 'sync-manifest',
      configPath: './custom.config.ts',
    })
  })

  it('parses manifest pull with defaults and flags', () => {
    expect(parseArgs(['manifest', 'pull'])).toEqual({
      command: 'manifest-pull',
      configPath: './areca.config.ts',
      yes: false,
    })
    expect(
      parseArgs(['manifest', 'pull', '--config', 'custom.config.ts', '-y']),
    ).toEqual({
      command: 'manifest-pull',
      configPath: 'custom.config.ts',
      yes: true,
    })
    expect(parseArgs(['manifest', 'pull', '--yes'])).toMatchObject({
      command: 'manifest-pull',
      yes: true,
    })
  })

  it('rejects a bad manifest subcommand', () => {
    expect(parseArgs(['manifest'])).toEqual({
      command: 'error',
      message: 'Missing manifest subcommand. Expected push or pull.',
    })
    expect(parseArgs(['manifest', 'sync'])).toEqual({
      command: 'error',
      message: 'Unknown manifest subcommand: sync',
    })
    expect(parseArgs(['manifest', 'pull', '--nope'])).toEqual({
      command: 'error',
      message: 'Unknown argument: --nope',
    })
    expect(parseArgs(['manifest', 'pull', '--config'])).toEqual({
      command: 'error',
      message: 'Missing value for --config',
    })
  })

  it('returns help for empty args', () => {
    expect(parseArgs([])).toEqual({ command: 'help' })
    expect(parseArgs(['--help'])).toEqual({ command: 'help' })
  })

  it('rejects unknown commands', () => {
    expect(parseArgs(['deploy'])).toEqual({
      command: 'error',
      message: 'Unknown command: deploy',
    })
  })
})

describe('run', () => {
  it('exits 1 when pull has no publication', async () => {
    process.env.ARECA_CMS_URL = 'https://cms.example.com'
    process.env.ARECA_SITE_TOKEN = 'site-token'
    globalThis.fetch = async () =>
      jsonResponse({ error: 'No live publication' }, 404)

    const outDir = mkdtempSync(join(tmpdir(), 'areca-site-sdk-'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(run(['pull', '--out', outDir])).resolves.toBe(1)
      expect(err.mock.calls.flat().join(' ')).toMatch(/No publication exists/)
    } finally {
      err.mockRestore()
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function authHeader(init?: RequestInit): string | null {
  const headers = new Headers(init?.headers)
  return headers.get('Authorization')
}
