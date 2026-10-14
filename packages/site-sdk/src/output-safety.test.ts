import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pullContent } from './pull.js'
import { manifestFromConfig } from './config.js'
import { createArecaClient } from './client.js'
import type { ArecaClient } from './client.js'
import { isReservedCollectionKey } from './identifiers.js'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function dir() {
  const result = mkdtempSync(join(tmpdir(), 'areca-safe-'))
  dirs.push(result)
  return result
}
function client(key: string): ArecaClient {
  return {
    fetchSnapshot: async () => ({
      publicationId: 'p',
      createdAt: '',
      hash: 'h',
      collections: { [key]: [] },
    }),
  } as unknown as ArecaClient
}
it.each([
  '../escape',
  '..\\escape',
  '/absolute',
  'manifest',
  '__proto__',
  'constructor',
  'CON',
  'x.json',
  'hello world',
])('rejects unsafe output key %s before writing', async (key) => {
  const outDir = dir()
  await expect(pullContent({ outDir, client: client(key) })).rejects.toThrow(/Unsafe/)
  expect(existsSync(join(outDir, 'manifest.json'))).toBe(false)
})
it.each(['resolve', 'href', 'preview', 'Preview', 'HREF'])(
  'rejects reserved collection key %s before writing',
  async (key) => {
    const outDir = dir()
    await expect(pullContent({ outDir, client: client(key) })).rejects.toThrow()
    expect(existsSync(join(outDir, 'manifest.json'))).toBe(false)
    expect(() =>
      manifestFromConfig({
        siteKey: 'x',
        collections: { [key]: { route: '/:slug', fields: [] } },
      }),
    ).toThrow()
  },
)

it('recognises reserved collection keys case-insensitively and nothing else', () => {
  for (const key of ['resolve', 'href', 'preview', 'Preview', 'RESOLVE']) {
    expect(isReservedCollectionKey(key)).toBe(true)
  }
  for (const key of ['previews', 'resolved', 'hrefs', 'blogPosts']) {
    expect(isReservedCollectionKey(key)).toBe(false)
  }
})

it('accepts reserved words as field keys', () => {
  expect(() =>
    manifestFromConfig({
      siteKey: 'x',
      collections: {
        articles: {
          route: '/:slug',
          fields: [
            { key: 'resolve', type: 'text', label: 'R' },
            { key: 'href', type: 'text', label: 'H' },
            { key: 'preview', type: 'text', label: 'P' },
          ],
        },
      },
    }),
  ).not.toThrow()
})

it('refuses existing symbolic link destination', async () => {
  const outDir = dir(),
    outside = join(dir(), 'outside.json')
  writeFileSync(outside, 'preserved')
  symlinkSync(outside, join(outDir, 'articles.json'))
  await expect(pullContent({ outDir, client: client('articles') })).rejects.toThrow(/symbolic link/)
  expect(readFileSync(outside, 'utf8')).toBe('preserved')
})
it('rejects duplicate and reserved field keys before manifest POST', () => {
  expect(() =>
    manifestFromConfig({
      siteKey: 'x',
      collections: {
        articles: {
          route: '/:slug',
          fields: [{ key: 'constructor', type: 'text', label: 'Bad' }],
        },
      },
    }),
  ).toThrow(/Unsafe/)
  expect(() =>
    manifestFromConfig({
      siteKey: 'x',
      collections: {
        articles: {
          route: '/:slug',
          fields: [
            { key: 'title', type: 'text', label: 'A' },
            { key: 'title', type: 'text', label: 'B' },
          ],
        },
      },
    }),
  ).toThrow(/Duplicate/)
})
it('never falls back to build token for schema writes', async () => {
  const previous = process.env.ARECA_SCHEMA_TOKEN
  delete process.env.ARECA_SCHEMA_TOKEN
  try {
    await expect(
      createArecaClient({
        cmsUrl: 'https://cms.test',
        siteToken: 'read',
      }).syncManifest({ siteKey: 'x', collections: {} }),
    ).rejects.toThrow(/ARECA_SCHEMA_TOKEN/)
  } finally {
    if (previous !== undefined) process.env.ARECA_SCHEMA_TOKEN = previous
  }
})
