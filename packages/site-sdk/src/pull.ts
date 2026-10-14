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
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path'
import {
  downloadAssets,
  localAssetFileNames,
  localizeCollections,
  pruneGenerations,
  writeAssetIndex,
  type MediaChanges,
  type ResolvedAssets,
} from './assets.js'

export type { ResolvedAssets } from './assets.js'
import { camelCollectionKeys, camelizeSnapshot } from './camel-case.js'
import { generateContentTypes } from './generate-types.js'
import { assertSafeIdentifier } from './identifiers.js'
import { createArecaClient, type ArecaClient } from './client.js'
import type { CollectionKey, Entry } from './schema-types.js'
import type {
  CollectionConfig,
  PulledContentManifest,
  Snapshot,
} from './types.js'
import { validateSnapshot } from './validate-snapshot.js'

/** Older generations kept next to the current one for readers that captured them. */
const PREVIOUS_GENERATIONS_KEPT = 2

export type PullContentOptions = {
  outDir: string
  client?: ArecaClient
  publicationId?: string
  /**
   * Copy media into `dir` and point the content at `publicPath`. Omit to keep
   * CMS URLs. The `areca pull` CLI resolves this from areca.config.ts.
   */
  assets?: ResolvedAssets
  /** Where `areca.gen.ts` is written. Default `<outDir>/areca.gen.ts`. */
  types?: string
  /**
   * The content directory as written into `areca.gen.ts`, relative to the
   * app's working directory. Default `outDir`. The CLI passes `--out` as given.
   */
  contentDir?: string
}

export type PullContentResult = Snapshot & {
  /** Set when media was copied locally. */
  localAssets?: { dir: string; total: number; downloaded: number }
  /** Set when the CMS does not list media, so URLs still point at it. */
  warnings: string[]
  /** The generated types file that was written. */
  typesPath: string
}

/**
 * Stage immutable files, then switch the manifest pointer in one atomic rename.
 * Validation runs before anything is staged, so a bad publication leaves the
 * previous generation and types file untouched.
 */
export async function pullContent(
  options: PullContentOptions,
): Promise<PullContentResult> {
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
  // Key checks run before any schema lookup, so unsafe keys fail first.
  const camelKeys = camelCollectionKeys(Object.keys(snapshot.collections))
  mkdirSync(options.outDir, { recursive: true })
  const base = realpathSync(options.outDir)
  // Keep the legacy guards even though new pulls no longer replace flat files.
  const manifestPath = containedPath(base, 'manifest')
  for (const camel of camelKeys.values()) containedPath(base, camel)
  const typesPath = options.types ?? join(options.outDir, 'areca.gen.ts')
  assertNotSymbolicLink(typesPath, 'Types output must not be a symbolic link')
  const warnings: string[] = []

  let schema: Record<string, CollectionConfig> | undefined = snapshot.schema
  if (schema === undefined) {
    schema = (await client.fetchManifest()).collections
    warnings.push(
      `Publication ${snapshot.publicationId} has no embedded schema; types use the current CMS schema. Go live again to embed it.`,
    )
  }
  // Raw keys, before anything is camelised or written.
  validateSnapshot(snapshot, schema)
  const camelized = camelizeSnapshot(snapshot, schema).collections

  let collections = camelized
  let localAssets: PullContentResult['localAssets']
  let assetFiles: string[] | undefined
  let media: MediaChanges | undefined
  if (options.assets && !snapshot.assets) {
    warnings.push(
      'This CMS version does not list media files, so media URLs still point at the CMS. Update the CMS to copy media locally.',
    )
  } else if (options.assets && snapshot.assets) {
    // Downloads finish before anything is staged: a failed download leaves
    // the current content and its media exactly as they were.
    const files = localAssetFileNames(snapshot.assets)
    media = await downloadAssets(
      snapshot.assets,
      files,
      options.assets.dir,
      client.fetchAsset,
    )
    collections = localizeCollections(camelized, files, {
      publicPath: options.assets.publicPath,
      siteUrl: snapshot.siteUrl,
    })
    assetFiles = [...files.values()]
    localAssets = {
      dir: options.assets.dir,
      total: snapshot.assets.length,
      downloaded: media.downloaded,
    }
  }
  // Created only once the publication is valid, so a rejected pull leaves no trace.
  const publications = safeDirectory(base, '.publications', true)
  let stage: string
  try {
    stage = mkdtempSync(join(publications, 'publication-'))
  } catch (error) {
    media?.rollback()
    throw error
  }
  const generation = relative(publications, stage)
  const temporaryManifest = join(base, `.manifest-${randomUUID()}.tmp`)
  try {
    for (const [key, entries] of Object.entries(collections)) {
      writeJson(containedPath(stage, key), entries)
    }
    if (assetFiles && options.assets) {
      writeAssetIndex(stage, base, options.assets.dir, assetFiles)
    }
    const manifest: PulledContentManifest = {
      publicationId: snapshot.publicationId,
      hash: snapshot.hash,
      createdAt: snapshot.createdAt,
      collections: Object.fromEntries(
        Object.entries(collections).map(([key, entries]) => [
          key,
          entries.length,
        ]),
      ),
      generation,
      ...(assetFiles && options.assets
        ? {
            assets: {
              publicPath: options.assets.publicPath,
              count: assetFiles.length,
            },
          }
        : {}),
    }
    writeJson(temporaryManifest, manifest, true)
    // Prior generations stay immutable for readers that already captured a pointer.
    renameSync(temporaryManifest, manifestPath)
  } catch (error) {
    rmSync(stage, { recursive: true, force: true })
    rmSync(temporaryManifest, { force: true })
    media?.rollback()
    throw error
  }
  // The new content is live from here on: cleanup problems are warnings,
  // not a failed pull.
  try {
    media?.commit()
    pruneGenerations(
      base,
      publications,
      generation,
      PREVIOUS_GENERATIONS_KEPT + 1,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    warnings.push(`Pulled, but cleaning up older content failed: ${detail}`)
  }
  // Types follow the content swap, so a failed pull never leaves them ahead.
  writeTextAtomically(
    typesPath,
    generateContentTypes({
      schema,
      dir: options.contentDir ?? options.outDir,
    }),
  )
  return {
    ...snapshot,
    schema,
    ...(localAssets ? { localAssets } : {}),
    warnings,
    typesPath,
  }
}

/** Capture once and pass to readContent for consistent reads across collections. */
export function readContentManifest(outDir: string): PulledContentManifest {
  return JSON.parse(
    readFileSync(containedPath(outDir, 'manifest'), 'utf8'),
  ) as PulledContentManifest
}

export function readContent<C extends CollectionKey>(
  outDir: string,
  collectionKey: C,
  capturedManifest?: PulledContentManifest,
): Entry<C>[] {
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
    ) as Entry<C>[]
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
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`, exclusive)
}

function writeText(filePath: string, text: string, exclusive = false): void {
  const fd = openSync(
    filePath,
    constants.O_WRONLY |
      constants.O_CREAT |
      (exclusive ? constants.O_EXCL : constants.O_TRUNC) |
      constants.O_NOFOLLOW,
  )
  try {
    writeFileSync(fd, text, 'utf8')
  } finally {
    closeSync(fd)
  }
}

/** Writes through a temporary file in the same directory, then renames it over the target. */
function writeTextAtomically(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporary = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`,
  )
  try {
    writeText(temporary, text, true)
    renameSync(temporary, filePath)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function assertNotSymbolicLink(filePath: string, message: string): void {
  try {
    if (lstatSync(filePath).isSymbolicLink()) throw new Error(message)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
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
