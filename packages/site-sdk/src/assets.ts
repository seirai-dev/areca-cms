import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'
import type {
  AssetsConfig,
  SeoMeta,
  Snapshot,
  SnapshotAsset,
  SnapshotGlobal,
} from './types.js'

import { DEFAULT_ASSETS_DIR } from './args.js'

/** Name of the per-generation list of local media files (never a collection key). */
export const ASSET_INDEX_FILE = '.assets.json'

const DOWNLOAD_CONCURRENCY = 6
const DOWNLOAD_TIMEOUT_MS = 60_000
const LOCAL_FILE_NAME = /^[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/
// Storage keys are `<organization>/<uuid>.<ext>`. Matching on the path, not
// the origin, also covers an APP_URL that differs from ARECA_CMS_URL.
const ASSET_FILE_URL =
  /(?:https?:\/\/[^\s"'<>()/\\]+)?\/api\/assets\/file\/([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g

export type ResolvedAssets = {
  /** Absolute directory the files are written to. */
  dir: string
  /** URL path prefix without a trailing slash; empty for the site root. */
  publicPath: string
}

/** `null` when downloads are turned off. `dir` must stay inside `root`. */
export function resolveAssetsConfig(
  config: AssetsConfig | undefined,
  root: string,
): ResolvedAssets | null {
  if (config?.download === false) return null
  const dir = (config?.dir ?? DEFAULT_ASSETS_DIR).trim()
  if (!dir) throw new Error('assets.dir must not be empty')
  const publicPath =
    config?.publicPath !== undefined
      ? normalizePublicPath(config.publicPath)
      : derivePublicPath(dir)
  if (publicPath === undefined) {
    throw new Error(
      `Cannot tell which URL serves ${dir}. Set assets.publicPath in areca.config.ts (for example '/${posix.basename(toPosix(dir))}').`,
    )
  }
  const absolute = resolve(root, dir)
  const inside = relative(resolve(root), absolute)
  // Pull writes and prunes files here: keep it inside the project.
  if (
    isAbsolute(dir) ||
    !inside ||
    /^\.\.(?:[\\/]|$)/.test(inside) ||
    isAbsolute(inside)
  ) {
    throw new Error(
      `assets.dir must be a folder inside the project, relative to it (for example 'public/areca'): ${dir}`,
    )
  }
  return { dir: absolute, publicPath }
}

/** `public/areca` → `/areca`; `undefined` for directories outside `public/`. */
export function derivePublicPath(dir: string): string | undefined {
  const normalized = posix.normalize(toPosix(dir.trim())).replace(/\/+$/, '')
  if (normalized === 'public') return ''
  if (!normalized.startsWith('public/')) return undefined
  return normalizePublicPath(normalized.slice('public'.length))
}

export function normalizePublicPath(value: string): string {
  const trimmed = value.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error(
      `assets.publicPath must be a path like /areca, not a URL: ${trimmed}`,
    )
  }
  const path = posix.normalize(`/${toPosix(trimmed)}`).replace(/\/+$/, '')
  return path === '/' ? '' : path
}

/**
 * Readable, stable file names: the original name as a slug plus part of the
 * unique storage id, e.g. `hero-banner-3f2a91c0.jpg`.
 */
export function localAssetFileNames(
  assets: SnapshotAsset[],
): Map<string, string> {
  const names = new Map<string, string>()
  const taken = new Set<string>()
  for (const asset of [...assets].sort((a, b) =>
    a.storageKey < b.storageKey ? -1 : 1,
  )) {
    const file = asset.storageKey.slice(asset.storageKey.lastIndexOf('/') + 1)
    const dot = file.lastIndexOf('.')
    const ext = (dot > 0 ? file.slice(dot + 1) : 'bin').toLowerCase()
    const id = (dot > 0 ? file.slice(0, dot) : file)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    const stem = slugify(asset.filename.replace(/\.[^.]*$/, '')) || 'asset'
    let name = `${stem}-${id.slice(0, 8) || 'file'}.${ext}`
    if (taken.has(name)) name = `${stem}-${id || randomUUID()}.${ext}`
    taken.add(name)
    names.set(asset.storageKey, name)
  }
  return names
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

/**
 * Points every CMS file URL at the local copy. Data gets root-relative URLs;
 * SEO data (og:image, JSON-LD) gets absolute ones when the site URL is known,
 * because crawlers do not resolve relative image URLs.
 */
export function localizeCollections(
  collections: Snapshot['collections'],
  files: Map<string, string>,
  options: { publicPath: string; siteUrl?: string | null },
): Snapshot['collections'] {
  const localize = localizeEntry(files, options)
  return Object.fromEntries(
    Object.entries(collections).map(([key, entries]) => [key, entries.map(localize)]),
  )
}

/** Same rewriting as `localizeCollections`, for site content sections. */
export function localizeGlobals(
  globals: Record<string, SnapshotGlobal>,
  files: Map<string, string>,
  options: { publicPath: string; siteUrl?: string | null },
): Record<string, SnapshotGlobal> {
  const localize = localizeEntry(files, options)
  return Object.fromEntries(
    Object.entries(globals).map(([key, global]) => [key, localize(global)]),
  )
}

/**
 * Rewrites the URLs of one entry or section. `data` and `seo` hold them, both
 * at the top level and in every `locales` view: the SDK serves a language's
 * view as-is, so the main language is rewritten through `locales` too.
 */
function localizeEntry(
  files: Map<string, string>,
  options: { publicPath: string; siteUrl?: string | null },
) {
  const local = (prefix: string) => (value: string) =>
    value.includes('/api/assets/file/')
      ? value.replace(ASSET_FILE_URL, (match, key: string) => {
          const name = files.get(key)
          return name ? `${prefix}/${name}` : match
        })
      : value
  const relativeUrl = local(options.publicPath)
  const absoluteUrl = options.siteUrl
    ? local(`${options.siteUrl.replace(/\/+$/, '')}${options.publicPath}`)
    : relativeUrl
  const localizeView = <V extends LocalizableView>(view: V): V => ({
    ...view,
    data: mapStrings(view.data, relativeUrl),
    ...(view.seo ? { seo: mapStrings(view.seo, absoluteUrl) } : {}),
  })
  return <T extends LocalizableView & { locales?: Record<string, LocalizableView> }>(
    entry: T,
  ): T => ({
    ...localizeView(entry),
    ...(entry.locales
      ? {
          locales: Object.fromEntries(
            Object.entries(entry.locales).map(([locale, view]) => [
              locale,
              localizeView(view),
            ]),
          ),
        }
      : {}),
  })
}

type LocalizableView = { data: Record<string, unknown>; seo?: SeoMeta }

function mapStrings<T>(value: T, map: (value: string) => string): T {
  if (typeof value === 'string') return map(value) as T
  if (Array.isArray(value))
    return value.map((item: unknown) => mapStrings(item, map)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]),
    ) as T
  }
  return value
}

export type AssetDownloader = (asset: SnapshotAsset) => Promise<Uint8Array>

/** Media written by a pull, undone together with the pull's content. */
export type MediaChanges = {
  downloaded: number
  /** Removes new files and puts replaced ones back. */
  rollback: () => void
  /** Drops the copies of replaced files once the new content is live. */
  commit: () => void
}

/**
 * Downloads files that are not on disk yet, or whose size is wrong. Every
 * download lands in a temporary file first; nothing in the media directory
 * changes until all of them succeed. Replaced files are kept aside until
 * `commit`, so `rollback` restores the directory exactly.
 */
export async function downloadAssets(
  assets: SnapshotAsset[],
  files: Map<string, string>,
  dir: string,
  download: AssetDownloader,
): Promise<MediaChanges> {
  const none: MediaChanges = { downloaded: 0, rollback: () => {}, commit: () => {} }
  if (assets.length === 0) return none
  const base = ensureAssetDirectory(dir)
  const pending = assets.filter((asset) => {
    const target = join(base, files.get(asset.storageKey)!)
    try {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error(`Refusing to replace ${target}: not a regular file`)
      return asset.size > 0 && stat.size !== asset.size
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return true
      throw error
    }
  })
  if (pending.length === 0) return none

  // Phase 1: download everything into temporary files.
  const staged: { temporary: string; target: string }[] = []
  const failures: string[] = []
  const work = async (asset: SnapshotAsset) => {
    const name = files.get(asset.storageKey)!
    const temporary = join(base, `.${name}.${randomUUID()}.tmp`)
    try {
      const bytes = await download(asset)
      if (asset.size > 0 && bytes.byteLength !== asset.size) {
        throw new Error(
          `expected ${asset.size} bytes, received ${bytes.byteLength}`,
        )
      }
      writeExclusive(temporary, bytes)
      staged.push({ temporary, target: join(base, name) })
    } catch (error) {
      rmSync(temporary, { force: true })
      const detail = error instanceof Error ? error.message : String(error)
      failures.push(`${asset.filename} (${asset.storageKey}): ${detail}`)
    }
  }
  for (let i = 0; i < pending.length; i += DOWNLOAD_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + DOWNLOAD_CONCURRENCY).map(work))
  }
  if (failures.length > 0) {
    for (const { temporary } of staged) rmSync(temporary, { force: true })
    throw new Error(
      `Failed to download ${failures.length} media file(s); the previous content is unchanged.\n  ${failures.join('\n  ')}`,
    )
  }

  // Phase 2: move the files into place, keeping replaced files aside.
  const placed: { target: string; backup?: string }[] = []
  const rollback = () => {
    for (const { target, backup } of placed.splice(0).reverse()) {
      rmSync(target, { force: true })
      if (backup) renameSync(backup, target)
    }
  }
  try {
    for (const { temporary, target } of staged) {
      let backup: string | undefined
      if (existsSync(target)) {
        backup = `${target}.${randomUUID()}.bak`
        renameSync(target, backup)
      }
      placed.push({ target, backup })
      renameSync(temporary, target)
    }
  } catch (error) {
    rollback()
    throw error
  } finally {
    for (const { temporary } of staged) rmSync(temporary, { force: true })
  }
  return {
    downloaded: staged.length,
    rollback,
    commit: () => {
      for (const { backup } of placed.splice(0)) {
        if (backup) rmSync(backup, { force: true })
      }
    },
  }
}

function writeExclusive(filePath: string, bytes: Uint8Array): void {
  const fd = openSync(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
  )
  try {
    writeFileSync(fd, bytes)
  } finally {
    closeSync(fd)
  }
}

/** Downloads from the CMS the SDK talks to (`ARECA_CMS_URL`), not the URL in the content. */
export function cmsAssetDownloader(
  cmsUrl: string,
  fetchImpl: typeof fetch = fetch,
): AssetDownloader {
  const base = cmsUrl.replace(/\/+$/, '')
  return async (asset) => {
    const path = asset.storageKey.split('/').map(encodeURIComponent).join('/')
    let res: Response
    try {
      res = await fetchImpl(`${base}/api/assets/file/${path}`, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`could not reach ${base}: ${detail}`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

export type AssetIndex = {
  /** Directory of the files, relative to the content output directory. */
  dir: string
  files: string[]
}

export function writeAssetIndex(
  generationDir: string,
  contentDir: string,
  assetsDir: string,
  files: Iterable<string>,
): void {
  const index: AssetIndex = {
    dir: toPosix(relative(contentDir, assetsDir)) || '.',
    files: [...new Set(files)].sort(),
  }
  const fd = openSync(
    join(generationDir, ASSET_INDEX_FILE),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
  )
  try {
    writeFileSync(fd, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function readAssetIndex(generationDir: string): AssetIndex | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(generationDir, ASSET_INDEX_FILE), 'utf8'),
    ) as Partial<AssetIndex>
    if (typeof parsed.dir !== 'string' || !Array.isArray(parsed.files))
      return null
    return {
      dir: parsed.dir,
      files: parsed.files.filter(
        (file): file is string =>
          typeof file === 'string' && LOCAL_FILE_NAME.test(file),
      ),
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    if (error instanceof SyntaxError) return null
    throw error
  }
}

/**
 * Deletes generations beyond the newest `keep` (the current one always stays)
 * and then the media files only those generations used. Files that no
 * generation ever recorded, such as your own files in the same directory, are
 * never touched.
 */
export function pruneGenerations(
  contentDir: string,
  publicationsDir: string,
  current: string,
  keep: number,
): { generations: number; files: number } {
  const all = listGenerations(publicationsDir)
  const ordered = [
    current,
    ...all
      .filter((name) => name !== current)
      .map((name) => ({
        name,
        mtime: lstatSync(join(publicationsDir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((item) => item.name),
  ]
  const retained = ordered.slice(0, Math.max(1, keep))
  const removed = ordered.slice(Math.max(1, keep))
  if (removed.length === 0) return { generations: 0, files: 0 }

  const inUse = new Set<string>()
  for (const name of retained) {
    const index = readAssetIndex(join(publicationsDir, name))
    if (!index) continue
    const dir = resolve(contentDir, index.dir)
    for (const file of index.files) inUse.add(join(dir, file))
  }
  const candidates = new Set<string>()
  for (const name of removed) {
    const index = readAssetIndex(join(publicationsDir, name))
    if (!index) continue
    const dir = resolve(contentDir, index.dir)
    for (const file of index.files) candidates.add(join(dir, file))
  }

  for (const name of removed) {
    rmSync(join(publicationsDir, name), { recursive: true, force: true })
  }
  let files = 0
  for (const file of candidates) {
    if (inUse.has(file)) continue
    try {
      if (!lstatSync(file).isFile()) continue
      rmSync(file, { force: true })
      files += 1
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    }
  }
  return { generations: removed.length, files }
}

function listGenerations(publicationsDir: string): string[] {
  // Directory entries only: a symlink named like a generation is never followed.
  return readdirSync(publicationsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && /^publication-[A-Za-z0-9_-]+$/.test(entry.name),
    )
    .map((entry) => entry.name)
}

function ensureAssetDirectory(dir: string): string {
  mkdirSync(dir, { recursive: true })
  if (lstatSync(dir).isSymbolicLink())
    throw new Error('Media directory must not be a symbolic link')
  const actual = realpathSync(dir)
  if (!isAbsolute(actual)) throw new Error('Unsafe media directory')
  return actual
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
