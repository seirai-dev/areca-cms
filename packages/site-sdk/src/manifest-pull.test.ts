import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArecaClient } from './client.js'
import {
  ManifestPullCancelledError,
  diffManifests,
  formatManifestDiff,
  manifestPull,
} from './manifest-pull.js'
import type { SiteContentConfig, SiteManifest } from './types.js'

const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('@clack/prompts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, confirm: confirmMock }
})

const remote: SiteManifest = {
  collections: {
    articles: {
      route: '/blog/$slug',
      label: 'Articles',
      fields: [
        { key: 'slug', label: 'Slug', type: 'slug', required: true },
        { key: 'title', label: 'Title', type: 'text', required: true },
      ],
    },
    pages: {
      route: '/$slug',
      label: 'Pages',
      fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
    },
  },
}

const originalSiteKey = process.env.ARECA_SITE_KEY

afterEach(() => {
  confirmMock.mockReset()
  if (originalSiteKey === undefined) delete process.env.ARECA_SITE_KEY
  else process.env.ARECA_SITE_KEY = originalSiteKey
})

function makeClient(manifest: SiteManifest = remote): ArecaClient {
  return {
    syncManifest: vi.fn(),
    fetchManifest: vi.fn().mockResolvedValue(manifest),
    fetchSnapshot: vi.fn(),
    fetchAsset: vi.fn(),
    fetchPreview: vi.fn(),
  }
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'areca-manifest-pull-'))
}

/** Writes a plain-JS config module so it can be imported without tsx. */
function writeConfig(dir: string, config: SiteContentConfig, name = 'areca.config.mjs'): string {
  writeFileSync(join(dir, name), `export default ${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return name
}

describe('diffManifests', () => {
  it('reports every collection as added when there is no local config', () => {
    expect(diffManifests(undefined, remote)).toEqual({
      added: ['articles', 'pages'],
      changed: [],
      removed: [],
    })
  })

  it('detects added, changed and removed collections', () => {
    const local: SiteContentConfig = {
      siteKey: 'demo',
      collections: {
        articles: {
          route: '/blog/$slug',
          label: 'Articles',
          fields: [{ key: 'slug', label: 'Slug', type: 'slug', required: true }],
        },
        legacy: { route: '/legacy/$slug', fields: [] },
      },
    }
    expect(diffManifests(local, remote)).toEqual({
      added: ['pages'],
      changed: ['articles'],
      removed: ['legacy'],
    })
  })

  it('treats a deep-equal collection as unchanged regardless of key order', () => {
    const local: SiteContentConfig = {
      siteKey: 'demo',
      collections: {
        articles: {
          label: 'Articles',
          route: '/blog/$slug',
          fields: [
            { label: 'Slug', key: 'slug', required: true, type: 'slug' },
            { type: 'text', key: 'title', label: 'Title', required: true },
          ],
        },
        pages: remote.collections.pages,
      },
    }
    expect(diffManifests(local, remote)).toEqual({ added: [], changed: [], removed: [] })
  })

  it('formats a diff summary', () => {
    expect(
      formatManifestDiff({ added: ['a'], changed: ['b'], removed: ['c'] }),
    ).toBe('  + a\n  ~ b\n  - c')
    expect(formatManifestDiff({ added: [], changed: [], removed: [] })).toBe('  (no changes)')
  })
})

describe('manifestPull', () => {
  it('writes a generated config using the existing siteKey', async () => {
    const dir = makeDir()
    try {
      const name = writeConfig(dir, { siteKey: 'acme-site', collections: {} })
      const result = await manifestPull({
        cwd: dir,
        configPath: name,
        client: makeClient(),
        interactive: false,
      })

      expect(result.collections).toBe(2)
      expect(result.diff.added).toEqual(['articles', 'pages'])
      const written = readFileSync(join(dir, name), 'utf8')
      expect(written).toContain("siteKey: 'acme-site'")
      expect(written).toContain("{ key: 'slug', label: 'Slug', type: 'slug', required: true },")
      expect(written).toBe(result.source)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the local assets settings when re-rendering the config', async () => {
    const dir = makeDir()
    try {
      const name = writeConfig(dir, {
        siteKey: 'acme-site',
        assets: { download: true, dir: 'static/media', publicPath: '/media' },
        collections: {},
      })
      await manifestPull({
        cwd: dir,
        configPath: name,
        client: makeClient(),
        interactive: false,
      })
      expect(readFileSync(join(dir, name), 'utf8')).toContain(
        "  siteKey: 'acme-site',\n  assets: {\n    download: true,\n    dir: 'static/media',\n    publicPath: '/media',\n  },\n  collections: {\n",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to ARECA_SITE_KEY when no config exists', async () => {
    const dir = makeDir()
    process.env.ARECA_SITE_KEY = 'env-site'
    try {
      const result = await manifestPull({
        cwd: dir,
        configPath: 'areca.config.mjs',
        client: makeClient(),
        interactive: false,
      })
      expect(result.source).toContain("siteKey: 'env-site'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('errors with an init hint when there is no config and no ARECA_SITE_KEY', async () => {
    const dir = makeDir()
    delete process.env.ARECA_SITE_KEY
    try {
      await expect(
        manifestPull({
          cwd: dir,
          configPath: 'areca.config.mjs',
          client: makeClient(),
          interactive: false,
        }),
      ).rejects.toThrow(/areca init/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite a populated config without --yes when not a TTY', async () => {
    const dir = makeDir()
    try {
      const name = writeConfig(dir, {
        siteKey: 'acme-site',
        collections: { legacy: { route: '/legacy/$slug', fields: [] } },
      })
      const before = readFileSync(join(dir, name), 'utf8')
      await expect(
        manifestPull({ cwd: dir, configPath: name, client: makeClient(), interactive: false }),
      ).rejects.toThrow(/--yes/)
      expect(readFileSync(join(dir, name), 'utf8')).toBe(before)
      expect(confirmMock).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('overwrites a populated config when --yes is passed, without prompting', async () => {
    const dir = makeDir()
    try {
      const name = writeConfig(dir, {
        siteKey: 'acme-site',
        collections: { legacy: { route: '/legacy/$slug', fields: [] } },
      })
      const result = await manifestPull({
        cwd: dir,
        configPath: name,
        yes: true,
        client: makeClient(),
        interactive: false,
      })
      expect(result.diff.removed).toEqual(['legacy'])
      expect(confirmMock).not.toHaveBeenCalled()
      expect(readFileSync(join(dir, name), 'utf8')).not.toContain('legacy')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prompts interactively and writes on confirm', async () => {
    const dir = makeDir()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    confirmMock.mockResolvedValue(true)
    try {
      const name = writeConfig(dir, {
        siteKey: 'acme-site',
        collections: { legacy: { route: '/legacy/$slug', fields: [] } },
      })
      await manifestPull({ cwd: dir, configPath: name, client: makeClient(), interactive: true })
      expect(confirmMock).toHaveBeenCalledTimes(1)
      const printed = log.mock.calls.flat().map(String).join('\n')
      expect(printed).toContain('+ articles')
      expect(printed).toContain('- legacy')
      expect(readFileSync(join(dir, name), 'utf8')).toContain("siteKey: 'acme-site'")
    } finally {
      log.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('aborts without writing when the prompt is declined', async () => {
    const dir = makeDir()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    confirmMock.mockResolvedValue(false)
    try {
      const name = writeConfig(dir, {
        siteKey: 'acme-site',
        collections: { legacy: { route: '/legacy/$slug', fields: [] } },
      })
      const before = readFileSync(join(dir, name), 'utf8')
      await expect(
        manifestPull({ cwd: dir, configPath: name, client: makeClient(), interactive: true }),
      ).rejects.toBeInstanceOf(ManifestPullCancelledError)
      expect(readFileSync(join(dir, name), 'utf8')).toBe(before)
    } finally {
      log.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
