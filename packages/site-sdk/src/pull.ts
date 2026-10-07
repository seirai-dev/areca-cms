import { assertSafeIdentifier } from './identifiers.js'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  realpathSync,
  constants,
  openSync,
  closeSync,
} from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createArecaClient, type ArecaClient } from './client.js'
import type { PulledContentManifest, Snapshot, SnapshotEntry } from './types.js'

export type PullContentOptions = {
  outDir: string
  client?: ArecaClient
}

export async function pullContent(options: PullContentOptions): Promise<Snapshot> {
  const client = options.client ?? createArecaClient()
  const snapshot = await client.fetchSnapshot()

  for (const key of Object.keys(snapshot.collections)) assertSafeIdentifier(key)
  mkdirSync(options.outDir, { recursive: true })

  const manifest: PulledContentManifest = {
    publicationId: snapshot.publicationId,
    hash: snapshot.hash,
    createdAt: snapshot.createdAt,
    collections: Object.fromEntries(
      Object.entries(snapshot.collections).map(([key, entries]) => [key, entries.length]),
    ),
  }

  writeJson(containedPath(options.outDir, 'manifest'), manifest)

  for (const [key, entries] of Object.entries(snapshot.collections)) {
    writeJson(containedPath(options.outDir, key), entries)
  }

  return snapshot
}

export function readContent<T = SnapshotEntry>(outDir: string, collectionKey: string): T[] {
  assertSafeIdentifier(collectionKey)
  let filePath: string
  try {
    filePath = containedPath(outDir, collectionKey)
  } catch (error) {
    // The output directory itself is missing: nothing has been pulled yet.
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `No content file for collection "${collectionKey}" in ${outDir}. Run \`areca pull\` first.`,
      )
    }
    throw error
  }
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
  const fd = openSync(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
  )
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function containedPath(outDir: string, key: string): string {
  const base = realpathSync(outDir)
  const target = resolve(base, `${key}.json`)
  const rel = relative(base, target)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Output path escapes content directory')
  try {
    if (lstatSync(target).isSymbolicLink())
      throw new Error('Content output must not be a symbolic link')
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
  return target
}
