import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cmsAssetDownloader,
  derivePublicPath,
  localAssetFileNames,
  localizeCollections,
  resolveAssetsConfig,
} from './assets.js'
import type { ArecaClient } from './client.js'
import { pullContent, readContent, readContentManifest } from './pull.js'
import type { Snapshot, SnapshotAsset } from './types.js'

const directories: string[] = []
afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})
function directory() {
  const value = mkdtempSync(join(tmpdir(), 'areca-assets-'))
  directories.push(value)
  return value
}

const ORG = '0b9e8f7a-1111-4222-8333-944455556666'
function asset(
  uuid: string,
  filename: string,
  ext = 'jpg',
  bytes = 3,
): SnapshotAsset {
  return {
    id: `asset-${uuid}`,
    storageKey: `${ORG}/${uuid}.${ext}`,
    url: `https://cms.test/api/assets/file/${ORG}/${uuid}.${ext}`,
    filename,
    mimeType: ext === 'pdf' ? 'application/pdf' : 'image/jpeg',
    size: bytes,
  }
}
const HERO = asset('3f2a91c0-aaaa-4bbb-8ccc-dddddddddddd', 'Hero Banner.JPG')
const BROCHURE = asset(
  '7e1d2c3b-aaaa-4bbb-8ccc-eeeeeeeeeeee',
  'Brochure (2026).pdf',
  'pdf',
)

function snapshotWith(assets: SnapshotAsset[] | undefined): Snapshot {
  const lanUrl = (item: SnapshotAsset) =>
    `http://192.168.1.10:3000/api/assets/file/${item.storageKey}`
  return {
    publicationId: 'pub',
    siteKey: 'site',
    createdAt: '',
    hash: 'h',
    siteUrl: 'https://www.acme.test',
    ...(assets ? { assets } : {}),
    collections: {
      articles: [
        {
          id: 'e',
          slug: 'welcome',
          publishedAt: null,
          data: {
            hero: { url: HERO.url, width: 1, height: 1, alt: '', mimeType: 'image/jpeg' },
            body: {
              json: { type: 'doc', content: [{ type: 'image', attrs: { src: HERO.url } }] },
              markdown: `![a](${HERO.url}) [pdf](${lanUrl(BROCHURE)}) ![b](https://images.test/x.jpg)`,
              html: `<img src="${HERO.url}"><a href="${BROCHURE.url}">pdf</a>`,
              document: { type: 'root', children: [] },
            },
          },
          seo: {
            openGraph: { image: { url: HERO.url } },
            jsonLd: [{ image: [HERO.url] }],
          } as never,
        },
      ],
    },
  }
}

describe('asset config', () => {
  it('defaults to public/areca served from /areca', () => {
    expect(resolveAssetsConfig(undefined, '/site')).toEqual({
      dir: '/site/public/areca',
      publicPath: '/areca',
    })
    expect(resolveAssetsConfig({ download: false }, '/site')).toBeNull()
  })

  it('derives public paths only under public/', () => {
    expect(derivePublicPath('public/media/')).toBe('/media')
    expect(derivePublicPath('./public/a/b')).toBe('/a/b')
    expect(derivePublicPath('public')).toBe('')
    expect(derivePublicPath('static/media')).toBeUndefined()
    expect(() =>
      resolveAssetsConfig({ dir: 'static/media' }, '/site'),
    ).toThrow(/assets\.publicPath/)
    expect(
      resolveAssetsConfig({ dir: 'static/media', publicPath: 'media/' }, '/site'),
    ).toEqual({ dir: '/site/static/media', publicPath: '/media' })
    expect(() =>
      resolveAssetsConfig({ publicPath: 'https://cdn.test/x' }, '/site'),
    ).toThrow(/not a URL/)
  })

  it('refuses media folders outside the project', () => {
    for (const dir of ['../shared/media', '/var/www/media', '.', 'public/../..']) {
      expect(() =>
        resolveAssetsConfig({ dir, publicPath: '/media' }, '/site'),
      ).toThrow(/inside the project/)
    }
    expect(
      resolveAssetsConfig({ dir: '..media', publicPath: '/m' }, '/site')?.dir,
    ).toBe('/site/..media')
  })

  it('names files after the original file plus a short unique id', () => {
    const names = localAssetFileNames([HERO, BROCHURE])
    expect(names.get(HERO.storageKey)).toBe('hero-banner-3f2a91c0.jpg')
    expect(names.get(BROCHURE.storageKey)).toBe('brochure-2026-7e1d2c3b.pdf')
    const clash = localAssetFileNames([
      asset('3f2a91c0-0000-4000-8000-000000000001', 'x.jpg'),
      asset('3f2a91c0-0000-4000-8000-000000000002', 'x.jpg'),
    ])
    expect(new Set(clash.values()).size).toBe(2)
  })
})

describe('localizeCollections', () => {
  it('rewrites every CMS URL, using absolute URLs for SEO only', () => {
    const files = localAssetFileNames([HERO, BROCHURE])
    const { articles } = localizeCollections(
      snapshotWith([HERO, BROCHURE]).collections,
      files,
      { publicPath: '/areca', siteUrl: 'https://www.acme.test/' },
    )
    const [entry] = articles!
    const text = JSON.stringify(entry!.data)
    expect(text).not.toContain('/api/assets/file/')
    expect(text).toContain('"url":"/areca/hero-banner-3f2a91c0.jpg"')
    expect(text).toContain('[pdf](/areca/brochure-2026-7e1d2c3b.pdf)')
    expect(text).toContain('href=\\"/areca/brochure-2026-7e1d2c3b.pdf\\"')
    expect(text).toContain('https://images.test/x.jpg')
    expect(JSON.stringify(entry!.seo)).toBe(
      JSON.stringify({
        openGraph: {
          image: { url: 'https://www.acme.test/areca/hero-banner-3f2a91c0.jpg' },
        },
        jsonLd: [{ image: ['https://www.acme.test/areca/hero-banner-3f2a91c0.jpg'] }],
      }),
    )
  })

  it('leaves URLs of files the CMS did not list', () => {
    const { articles } = localizeCollections(
      snapshotWith([HERO]).collections,
      localAssetFileNames([HERO]),
      { publicPath: '' },
    )
    const text = JSON.stringify(articles![0]!.data)
    expect(text).toContain('"url":"/hero-banner-3f2a91c0.jpg"')
    expect(text).toContain(BROCHURE.url)
  })
})

function client(
  value: Snapshot,
  fetchAsset = vi.fn(async (item: SnapshotAsset) =>
    new TextEncoder().encode('x'.repeat(item.size)),
  ),
): ArecaClient & { fetchAsset: typeof fetchAsset } {
  return {
    fetchSnapshot: vi.fn().mockResolvedValue(value),
    fetchAsset,
  } as unknown as ArecaClient & { fetchAsset: typeof fetchAsset }
}

describe('pullContent with local media', () => {
  it('downloads media, rewrites content and skips files already present', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const assets = { dir: join(root, 'public/areca'), publicPath: '/areca' }
    const first = client(snapshotWith([HERO, BROCHURE]))
    const result = await pullContent({ outDir, client: first, assets })
    expect(result.localAssets).toMatchObject({ total: 2, downloaded: 2 })
    expect(readdirSync(assets.dir).sort()).toEqual([
      'brochure-2026-7e1d2c3b.pdf',
      'hero-banner-3f2a91c0.jpg',
    ])
    const [entry] = readContent<{ data: { hero: { url: string } } }>(
      outDir,
      'articles',
    )
    expect(entry!.data.hero.url).toBe('/areca/hero-banner-3f2a91c0.jpg')
    expect(readContentManifest(outDir).assets).toEqual({
      publicPath: '/areca',
      count: 2,
    })

    const second = client(snapshotWith([HERO, BROCHURE]))
    const again = await pullContent({ outDir, client: second, assets })
    expect(second.fetchAsset).not.toHaveBeenCalled()
    expect(again.localAssets?.downloaded).toBe(0)
  })

  it('keeps the previous content and media when a download fails', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const assets = { dir: join(root, 'public/areca'), publicPath: '/areca' }
    await pullContent({ outDir, client: client(snapshotWith([HERO])), assets })
    const before = readContentManifest(outDir)

    const failing = client(
      snapshotWith([HERO, BROCHURE]),
      vi.fn(async (item: SnapshotAsset) => {
        if (item === BROCHURE) throw new Error('HTTP 404')
        return new TextEncoder().encode('xxx')
      }),
    )
    await expect(
      pullContent({ outDir, client: failing, assets }),
    ).rejects.toThrow(/Brochure \(2026\)\.pdf.*HTTP 404/)
    expect(readContentManifest(outDir)).toEqual(before)
    expect(readdirSync(assets.dir)).toEqual(['hero-banner-3f2a91c0.jpg'])
  })

  it('restores a replaced file and leaves no temporary files when another download fails', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const assets = { dir: join(root, 'public/areca'), publicPath: '/areca' }
    await pullContent({ outDir, client: client(snapshotWith([HERO])), assets })
    // A damaged copy (wrong size) is due for replacement on the next pull.
    writeFileSync(join(assets.dir, 'hero-banner-3f2a91c0.jpg'), 'damaged')

    const failing = client(
      snapshotWith([HERO, BROCHURE]),
      vi.fn(async (item: SnapshotAsset) => {
        if (item === BROCHURE) throw new Error('HTTP 500')
        return new TextEncoder().encode('xxx')
      }),
    )
    await expect(
      pullContent({ outDir, client: failing, assets }),
    ).rejects.toThrow(/HTTP 500/)
    expect(readdirSync(assets.dir)).toEqual(['hero-banner-3f2a91c0.jpg'])
    expect(readFileSync(join(assets.dir, 'hero-banner-3f2a91c0.jpg'), 'utf8')).toBe(
      'damaged',
    )

    // A successful pull replaces it and drops the kept-aside copy.
    await pullContent({ outDir, client: client(snapshotWith([HERO])), assets })
    expect(readdirSync(assets.dir)).toEqual(['hero-banner-3f2a91c0.jpg'])
    expect(readFileSync(join(assets.dir, 'hero-banner-3f2a91c0.jpg'), 'utf8')).toBe(
      'xxx',
    )
  })

  it('reports a cleanup failure after the switch as a warning', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const publications = join(outDir, '.publications')
    const locked = join(publications, 'publication-old0', 'locked')
    mkdirSync(locked, { recursive: true })
    writeFileSync(join(locked, 'file.json'), '[]')
    // The locked generation is the oldest, so it is the one pruned.
    for (const [age, name] of ['publication-old0', 'publication-old1', 'publication-old2'].entries()) {
      mkdirSync(join(publications, name), { recursive: true })
      const time = new Date(Date.now() - (3 - age) * 60_000)
      utimesSync(join(publications, name), time, time)
    }
    chmodSync(locked, 0o500)
    try {
      const result = await pullContent({
        outDir,
        client: client(snapshotWith([])),
      })
      expect(result.warnings.join('\n')).toMatch(/cleaning up older content failed/)
      expect(readContentManifest(outDir).generation).not.toMatch(/old/)
    } finally {
      chmodSync(locked, 0o700)
    }
  })

  it('rejects a file whose size does not match', async () => {
    const root = directory()
    await expect(
      pullContent({
        outDir: join(root, 'content'),
        client: client(
          snapshotWith([HERO]),
          vi.fn(async () => new TextEncoder().encode('x')),
        ),
        assets: { dir: join(root, 'media'), publicPath: '/media' },
      }),
    ).rejects.toThrow(/expected 3 bytes, received 1/)
  })

  it('warns and keeps CMS URLs when the CMS does not list media', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const result = await pullContent({
      outDir,
      client: client(snapshotWith(undefined)),
      assets: { dir: join(root, 'public/areca'), publicPath: '/areca' },
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.localAssets).toBeUndefined()
    expect(JSON.stringify(readContent(outDir, 'articles'))).toContain(HERO.url)
  })

  it('keeps two previous generations and prunes media only they used', async () => {
    const root = directory()
    const outDir = join(root, 'content')
    const assets = { dir: join(root, 'public/areca'), publicPath: '/areca' }
    await pullContent({ outDir, client: client(snapshotWith([BROCHURE])), assets })
    // Your own files in the media directory are never removed.
    writeFileSync(join(assets.dir, 'logo.svg'), '<svg/>')
    const age = (seconds: number) => {
      const publications = join(outDir, '.publications')
      const current = readContentManifest(outDir).generation!
      const time = new Date(Date.now() - seconds * 1000)
      utimesSync(join(publications, current), time, time)
    }
    age(40)
    for (const seconds of [30, 20, 10]) {
      await pullContent({ outDir, client: client(snapshotWith([HERO])), assets })
      age(seconds)
    }
    await pullContent({ outDir, client: client(snapshotWith([HERO])), assets })

    expect(readdirSync(join(outDir, '.publications'))).toHaveLength(3)
    expect(existsSync(join(assets.dir, 'brochure-2026-7e1d2c3b.pdf'))).toBe(false)
    expect(readdirSync(assets.dir).sort()).toEqual([
      'hero-banner-3f2a91c0.jpg',
      'logo.svg',
    ])
    expect(readFileSync(join(assets.dir, 'logo.svg'), 'utf8')).toBe('<svg/>')
  })
})

describe('cmsAssetDownloader', () => {
  it('downloads from the configured CMS URL without credentials', async () => {
    const fetch = vi.fn(async () => new Response('abc'))
    const bytes = await cmsAssetDownloader('http://cms.lan:3000/', fetch)(HERO)
    expect(new TextDecoder().decode(bytes)).toBe('abc')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`http://cms.lan:3000/api/assets/file/${HERO.storageKey}`)
    expect(new Headers(init.headers).get('Authorization')).toBeNull()

    await expect(
      cmsAssetDownloader('http://cms.lan', async () => new Response('', { status: 404 }))(HERO),
    ).rejects.toThrow('HTTP 404')
  })
})
