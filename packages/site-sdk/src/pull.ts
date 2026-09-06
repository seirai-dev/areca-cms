import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createArecaClient, type ArecaClient } from './client.js'
import type { PulledContentManifest, Snapshot, SnapshotEntry } from './types.js'

export type PullContentOptions = {
  outDir: string
  client?: ArecaClient
}

export async function pullContent(options: PullContentOptions): Promise<Snapshot> {
  const client = options.client ?? createArecaClient()
  const snapshot = await client.fetchSnapshot()

  mkdirSync(options.outDir, { recursive: true })

  const manifest: PulledContentManifest = {
    publicationId: snapshot.publicationId,
    hash: snapshot.hash,
    createdAt: snapshot.createdAt,
    collections: Object.fromEntries(
      Object.entries(snapshot.collections).map(([key, entries]) => [key, entries.length]),
    ),
  }

  writeJson(join(options.outDir, 'manifest.json'), manifest)

  for (const [key, entries] of Object.entries(snapshot.collections)) {
    writeJson(join(options.outDir, `${key}.json`), entries)
  }

  return snapshot
}

export function readContent<T = SnapshotEntry>(outDir: string, collectionKey: string): T[] {
  const filePath = join(outDir, `${collectionKey}.json`)
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T[]
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `No content file for collection "${collectionKey}" at ${filePath}. Run \`areca pull\` first.`,
      )
    }
    throw error
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
