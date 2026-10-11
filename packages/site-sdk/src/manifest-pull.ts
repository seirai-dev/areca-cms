import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { confirm, isCancel } from '@clack/prompts'
import { type ArecaClient, createArecaClient } from './client.js'
import { manifestFromConfig } from './config.js'
import { generateConfigSource } from './generate-config.js'
import { loadConfig } from './load-config.js'
import type { CollectionConfig, SiteContentConfig, SiteManifest } from './types.js'

export class ManifestPullCancelledError extends Error {
  constructor() {
    super('Aborted')
    this.name = 'ManifestPullCancelledError'
  }
}

export type ManifestDiff = {
  added: string[]
  changed: string[]
  removed: string[]
}

export type ManifestPullOptions = {
  cwd?: string
  configPath: string
  yes?: boolean
  client?: ArecaClient
  /** Overrides the TTY check (tests). */
  interactive?: boolean
}

export type ManifestPullResult = {
  configPath: string
  collections: number
  diff: ManifestDiff
  source: string
}

/**
 * Compares the local config (normalised through `manifestFromConfig`) with a
 * manifest fetched from the CMS. `changed` means the collection exists on both
 * sides but is not deep-equal.
 */
export function diffManifests(
  local: SiteContentConfig | undefined,
  remote: SiteManifest,
): ManifestDiff {
  const localCollections = local ? manifestFromConfig(local).collections : {}
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []

  for (const key of Object.keys(remote.collections).sort()) {
    const before = localCollections[key]
    if (!before) {
      added.push(key)
    } else if (!deepEqual(normalize(before), normalize(remote.collections[key] as CollectionConfig))) {
      changed.push(key)
    }
  }

  for (const key of Object.keys(localCollections).sort()) {
    if (!remote.collections[key]) removed.push(key)
  }

  return { added, changed, removed }
}

export function formatManifestDiff(diff: ManifestDiff): string {
  const lines: string[] = []
  for (const key of diff.added) lines.push(`  + ${key}`)
  for (const key of diff.changed) lines.push(`  ~ ${key}`)
  for (const key of diff.removed) lines.push(`  - ${key}`)
  return lines.length > 0 ? lines.join('\n') : '  (no changes)'
}

export async function manifestPull(options: ManifestPullOptions): Promise<ManifestPullResult> {
  const cwd = options.cwd ?? process.cwd()
  const absConfigPath = resolve(cwd, options.configPath)
  const client = options.client ?? createArecaClient()
  const manifest = await client.fetchManifest()

  const existing = existsSync(absConfigPath) ? await loadConfig(absConfigPath, cwd) : undefined
  const siteKey = existing?.siteKey?.trim() || process.env.ARECA_SITE_KEY?.trim()
  if (!siteKey) {
    throw new Error(
      `No siteKey found. ${options.configPath} does not exist and ARECA_SITE_KEY is not set. Run \`areca init\` first.`,
    )
  }

  const diff = diffManifests(existing, manifest)
  const existingCount = existing ? Object.keys(existing.collections).length : 0
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY)

  if (existingCount > 0 && options.yes !== true) {
    if (!interactive) {
      throw new Error(
        `${options.configPath} already defines ${existingCount} collection(s). Re-run with --yes to overwrite it.`,
      )
    }

    console.log(`Changes to ${options.configPath}:`)
    console.log(formatManifestDiff(diff))

    const answer = await confirm({ message: `Overwrite ${options.configPath}?` })
    if (isCancel(answer) || answer !== true) {
      throw new ManifestPullCancelledError()
    }
  }

  const source = generateConfigSource({
    siteKey,
    // Local settings survive a re-render; only collections come from the CMS.
    ...(existing?.assets !== undefined ? { assets: existing.assets } : {}),
    collections: manifest.collections,
  })
  writeFileSync(absConfigPath, source, 'utf8')

  return {
    configPath: options.configPath,
    collections: Object.keys(manifest.collections).length,
    diff,
    source,
  }
}

function normalize(collection: CollectionConfig): unknown {
  return JSON.parse(JSON.stringify(collection)) as unknown
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]))
  }
  return value
}
