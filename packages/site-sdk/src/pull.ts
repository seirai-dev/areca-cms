import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  realpathSync,
  constants,
  openSync,
  closeSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import {
  assertSafeIdentifier,
  assertUniqueCollectionIdentifiers,
} from './identifiers.js'
import { createArecaClient, type ArecaClient } from './client.js'
import type { PulledContentManifest, Snapshot, SnapshotEntry } from './types.js'

export type PullContentOptions = {
  outDir: string
  client?: ArecaClient
  publicationId?: string
}

/** Stage immutable files, then switch the manifest pointer in one atomic rename. */
export async function pullContent(
  options: PullContentOptions,
): Promise<Snapshot> {
  const client = options.client ?? createArecaClient()
  const publicationId = options.publicationId ?? configuredPublicationId()
  const snapshot = await client.fetchSnapshot(
    publicationId ? { publicationId } : undefined,
  )
  if (publicationId && snapshot.publicationId !== publicationId) {
    throw new Error(
      `Expected publication ${publicationId}, received ${snapshot.publicationId}`,
    )
  }
  assertUniqueCollectionIdentifiers(Object.keys(snapshot.collections))
  mkdirSync(options.outDir, { recursive: true })
  const base = realpathSync(options.outDir)
  // Keep the legacy guards even though new pulls no longer replace flat files.
  const manifestPath = containedPath(base, 'manifest')
  for (const key of Object.keys(snapshot.collections)) containedPath(base, key)
  const publications = safeDirectory(base, '.publications', true)
  const stage = mkdtempSync(join(publications, 'publication-'))
  const generation = relative(publications, stage)
  const temporaryManifest = join(base, `.manifest-${randomUUID()}.tmp`)
  try {
    for (const [key, entries] of Object.entries(snapshot.collections)) {
      writeJson(containedPath(stage, key), entries)
    }
    const manifest: PulledContentManifest = {
      publicationId: snapshot.publicationId,
      hash: snapshot.hash,
      createdAt: snapshot.createdAt,
      collections: Object.fromEntries(
        Object.entries(snapshot.collections).map(([key, entries]) => [
          key,
          entries.length,
        ]),
      ),
      generation,
    }
    writeJson(temporaryManifest, manifest, true)
    // Prior generations stay immutable for readers that already captured a pointer.
    renameSync(temporaryManifest, manifestPath)
  } catch (error) {
    rmSync(stage, { recursive: true, force: true })
    rmSync(temporaryManifest, { force: true })
    throw error
  }
  return snapshot
}

/** Capture once and pass to readContent for consistent reads across collections. */
export function readContentManifest(outDir: string): PulledContentManifest {
  return JSON.parse(
    readFileSync(containedPath(outDir, 'manifest'), 'utf8'),
  ) as PulledContentManifest
}

export function readContent<T = SnapshotEntry>(
  outDir: string,
  collectionKey: string,
  capturedManifest?: PulledContentManifest,
): T[] {
  assertSafeIdentifier(collectionKey)
  try {
    let manifest = capturedManifest
    if (!manifest) {
      try {
        manifest = readContentManifest(outDir)
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') throw error
        // Legacy integrations may have only a flat collection file.
      }
    }
    if (manifest && !Object.hasOwn(manifest.collections, collectionKey)) {
      throw new Error(
        `Collection "${collectionKey}" is not in the current publication`,
      )
    }
    let directory = outDir
    if (manifest?.generation !== undefined) {
      if (!/^publication-[A-Za-z0-9_-]+$/.test(manifest.generation)) {
        throw new Error('Unsafe content generation identifier')
      }
      const base = realpathSync(outDir)
      const publications = safeDirectory(base, '.publications')
      directory = safeDirectory(publications, manifest.generation)
    }
    return JSON.parse(
      readFileSync(containedPath(directory, collectionKey), 'utf8'),
    ) as T[]
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `No content file for collection "${collectionKey}" in ${outDir}. Run \`areca pull\` first.`,
      )
    }
    throw error
  }
}

function configuredPublicationId(): string | undefined {
  const value = process.env.ARECA_SNAPSHOT_ID?.trim()
  // Existing deployment setup uses 0 to mean no publication has been selected.
  return value && value !== '0' ? value : undefined
}

function writeJson(filePath: string, value: unknown, exclusive = false): void {
  const fd = openSync(
    filePath,
    constants.O_WRONLY |
      constants.O_CREAT |
      (exclusive ? constants.O_EXCL : constants.O_TRUNC) |
      constants.O_NOFOLLOW,
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

function safeDirectory(base: string, name: string, create = false): string {
  const target = join(base, name)
  try {
    if (lstatSync(target).isSymbolicLink())
      throw new Error('Content directory must not be a symbolic link')
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT' || !create) throw error
    mkdirSync(target)
  }
  const actual = realpathSync(target)
  if (actual !== target || !lstatSync(target).isDirectory())
    throw new Error('Unsafe content directory')
  return actual
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
