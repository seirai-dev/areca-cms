import { afterEach, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArecaClient, type ArecaClient } from './client.js'
import { manifestFromConfig } from './config.js'
import { parseArgs } from './args.js'
import { pullContent, readContent, readContentManifest } from './pull.js'
import type { Snapshot } from './types.js'

const directories: string[] = []
const previousPin = process.env.ARECA_SNAPSHOT_ID
const previousFetch = globalThis.fetch
afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  if (previousPin === undefined) delete process.env.ARECA_SNAPSHOT_ID
  else process.env.ARECA_SNAPSHOT_ID = previousPin
  globalThis.fetch = previousFetch
})
function directory() {
  const value = mkdtempSync(join(tmpdir(), 'areca-generations-'))
  directories.push(value)
  return value
}
function snapshot(
  publicationId: string,
  collections: Snapshot['collections'],
): Snapshot {
  return {
    publicationId,
    hash: publicationId,
    createdAt: '',
    siteKey: 'site',
    collections,
  }
}
function client(value: Snapshot): ArecaClient {
  return {
    fetchSnapshot: vi.fn().mockResolvedValue(value),
  } as unknown as ArecaClient
}
const article = (title: string) => ({
  id: 'entry',
  slug: 'article',
  publishedAt: null,
  data: { title },
})

it('keeps the previous complete generation when staging another publication fails', async () => {
  const outDir = directory()
  await pullContent({
    outDir,
    client: client(snapshot('old', { articles: [article('old')] })),
  })
  const previous = readContentManifest(outDir)
  const cyclic: unknown[] = []
  cyclic.push(cyclic)
  await expect(
    pullContent({
      outDir,
      client: client(
        snapshot('new', {
          articles: [article('new')],
          broken: cyclic as Snapshot['collections'][string],
        }),
      ),
    }),
  ).rejects.toThrow(/circular/i)
  expect(readContentManifest(outDir)).toEqual(previous)
  expect(readContent(outDir, 'articles')).toEqual([article('old')])
  expect(readdirSync(join(outDir, '.publications'))).toEqual([
    previous.generation,
  ])
})

it('captured readers stay on one generation after another pull switches the pointer', async () => {
  const outDir = directory()
  await pullContent({
    outDir,
    client: client(snapshot('old', { articles: [article('old')], pages: [] })),
  })
  const captured = readContentManifest(outDir)
  await pullContent({
    outDir,
    client: client(snapshot('new', { articles: [article('new')] })),
  })
  expect(readContent(outDir, 'articles')).toEqual([article('new')])
  expect(readContent(outDir, 'articles', captured)).toEqual([article('old')])
  expect(readContent(outDir, 'pages', captured)).toEqual([])
  expect(() => readContent(outDir, 'pages')).toThrow(
    /not in the current publication/,
  )
})

it('enforces current membership even when a removed legacy flat file remains', async () => {
  const outDir = directory()
  writeFileSync(
    join(outDir, 'articles.json'),
    JSON.stringify([article('legacy')]),
  )
  expect(readContent(outDir, 'articles')).toEqual([article('legacy')])
  await pullContent({ outDir, client: client(snapshot('new', {})) })
  expect(() => readContent(outDir, 'articles')).toThrow(
    /not in the current publication/,
  )
})

it('rejects generation path traversal and symbolic link directories', async () => {
  const outDir = directory()
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify({ collections: { articles: 1 }, generation: '../outside' }),
  )
  expect(() => readContent(outDir, 'articles')).toThrow(
    /Unsafe content generation/,
  )
  symlinkSync(directory(), join(outDir, '.publications'))
  await expect(
    pullContent({ outDir, client: client(snapshot('new', {})) }),
  ).rejects.toThrow(/symbolic link/)
})

it('rejects keys differing only by case before writing or syncing a manifest', async () => {
  const outDir = directory()
  await expect(
    pullContent({
      outDir,
      client: client(snapshot('new', { Articles: [], articles: [] })),
    }),
  ).rejects.toThrow(/only by case/)
  expect(readdirSync(outDir)).toEqual([])
  expect(() =>
    manifestFromConfig({
      siteKey: 'site',
      collections: {
        Articles: { route: '/', fields: [] },
        articles: { route: '/', fields: [] },
      },
    }),
  ).toThrow(/only by case/)
})

it('pins pulls from the deployment environment and rejects unexpected responses', async () => {
  process.env.ARECA_SNAPSHOT_ID = 'expected'
  const fetchSnapshot = vi.fn().mockResolvedValue(snapshot('wrong', {}))
  await expect(
    pullContent({
      outDir: directory(),
      client: { fetchSnapshot } as unknown as ArecaClient,
    }),
  ).rejects.toThrow(/Expected publication expected/)
  expect(fetchSnapshot).toHaveBeenCalledWith({ publicationId: 'expected' })
  process.env.ARECA_SNAPSHOT_ID = '0'
  await pullContent({
    outDir: directory(),
    client: client(snapshot('live', {})),
  })
})

it('sends explicit publication query and checks the returned ID', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(snapshot('wrong', {})))
  globalThis.fetch = fetch
  await expect(
    createArecaClient({
      cmsUrl: 'https://cms.test',
      siteToken: 'read',
    }).fetchSnapshot({ publicationId: 'expected' }),
  ).rejects.toThrow(/Expected publication expected/)
  expect(fetch.mock.calls[0]?.[0]).toBe(
    'https://cms.test/api/sites/snapshot/current?publicationId=expected',
  )
  expect(parseArgs(['pull', '--publication', 'expected'])).toEqual({
    command: 'pull',
    outDir: 'src/generated/content',
    publicationId: 'expected',
  })
})
