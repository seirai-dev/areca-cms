import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { confirm, isCancel } from '@clack/prompts'
import { type ArecaClient, createArecaClient } from './client.js'
import { manifestFromConfig } from './config.js'
import { generateConfigSource, isGeneratedConfigSource } from './generate-config.js'
import { loadConfig } from './load-config.js'
import type {
  CollectionConfig,
  GlobalConfig,
  SiteContentConfig,
  SiteLanguages,
  SiteManifest,
} from './types.js'

export class ManifestPullCancelledError extends Error {
  constructor() {
    super('Aborted')
    this.name = 'ManifestPullCancelledError'
  }
}

export type KeyDiff = {
  added: string[]
  changed: string[]
  removed: string[]
}

export type LanguagesDiff = {
  added: string[]
  removed: string[]
  /** Only when both sides have languages and the main one differs. */
  main?: { from: string; to: string }
}

/** A field the CMS no longer has, in a collection or in a site content section. */
export type FieldRemoval = {
  /** Collection key, or site content section key. */
  owner: string
  key: string
  site: boolean
}

export type ManifestDiff = KeyDiff & {
  /** Site content sections. Only present when either side has any. */
  globals?: KeyDiff
  /** Site languages. Only present when either side has languages. */
  languages?: LanguagesDiff
  /** Fields dropped from a collection or section that exists on both sides. Only present when there are some. */
  removedFields?: FieldRemoval[]
}

export type ManifestPullOptions = {
  cwd?: string
  configPath: string
  /** Accepts every confirmation: overwriting the config and removing or changing languages. */
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
  /** True when the config already matched the CMS, so nothing was written. */
  unchanged: boolean
}

/**
 * Compares the local config (normalised through `manifestFromConfig`) with a
 * manifest fetched from the CMS. `changed` means the collection (or site
 * content section) exists on both sides but is not deep-equal.
 */
export function diffManifests(
  local: SiteContentConfig | undefined,
  remote: SiteManifest,
): ManifestDiff {
  const normalized = local ? manifestFromConfig(local) : undefined
  const diff: ManifestDiff = compareKeys(normalized?.collections ?? {}, remote.collections)

  const localGlobals = normalized?.globals ?? {}
  const remoteGlobals = remote.globals ?? {}
  if (Object.keys(localGlobals).length > 0 || Object.keys(remoteGlobals).length > 0) {
    diff.globals = compareKeys(localGlobals, remoteGlobals)
  }
  const removedFields = [
    ...fieldRemovals(normalized?.collections ?? {}, remote.collections, false),
    ...fieldRemovals(localGlobals, remoteGlobals, true),
  ]
  if (removedFields.length > 0) diff.removedFields = removedFields
  const languages = compareLanguages(local?.languages, remote.languages)
  if (languages) diff.languages = languages
  return diff
}

function fieldRemovals(
  local: Record<string, { fields: readonly { key: string }[] }>,
  remote: Record<string, { fields: readonly { key: string }[] }>,
  site: boolean,
): FieldRemoval[] {
  const removals: FieldRemoval[] = []
  for (const owner of Object.keys(remote).sort()) {
    const before = local[owner]
    if (!before) continue
    const after = new Set(remote[owner]!.fields.map((field) => field.key))
    for (const field of before.fields) {
      if (!after.has(field.key)) removals.push({ owner, key: field.key, site })
    }
  }
  return removals
}

function compareLanguages(
  local: SiteLanguages | undefined,
  remote: SiteLanguages | undefined,
): LanguagesDiff | undefined {
  if (!local && !remote) return undefined
  const before = local?.all ?? []
  const after = remote?.all ?? []
  const main =
    local && remote && local.main !== remote.main
      ? { from: local.main, to: remote.main }
      : undefined
  return {
    added: after.filter((language) => !before.includes(language)),
    removed: before.filter((language) => !after.includes(language)),
    ...(main ? { main } : {}),
  }
}

/**
 * Language changes that take languages away from the site: a removed language
 * stops being served, and a new main language changes the fallback chain. Each
 * one is a sentence, e.g. `remove language de`.
 */
export function languageRisks(diff: ManifestDiff): string[] {
  const risks = (diff.languages?.removed ?? []).map((language) => `remove language ${language}`)
  if (diff.languages?.main) {
    risks.push(
      `change the main language from ${diff.languages.main.from} to ${diff.languages.main.to}`,
    )
  }
  return risks
}

/**
 * Every change that takes something away: a collection, a site content section,
 * a field, a language, or the main language. Each one is a sentence. The pull
 * asks before writing when there is at least one (see `manifestPull`).
 */
export function removalsOf(diff: ManifestDiff): string[] {
  return [
    ...diff.removed.map((key) => `remove collection ${key}`),
    ...(diff.globals?.removed ?? []).map((key) => `remove site content section ${key}`),
    ...(diff.removedFields ?? []).map(
      (field) => `remove field ${field.key} from ${field.owner}`,
    ),
    ...languageRisks(diff),
  ]
}

function compareKeys(
  local: Record<string, CollectionConfig | GlobalConfig>,
  remote: Record<string, CollectionConfig | GlobalConfig>,
): KeyDiff {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []

  for (const key of Object.keys(remote).sort()) {
    const before = local[key]
    if (!before) {
      added.push(key)
    } else if (!deepEqual(normalize(before), normalize(remote[key]!))) {
      changed.push(key)
    }
  }

  for (const key of Object.keys(local).sort()) {
    if (!remote[key]) removed.push(key)
  }

  return { added, changed, removed }
}

function diffLines(diff: ManifestDiff): string[] {
  const lines: string[] = []
  for (const key of diff.added) lines.push(`  + ${key}`)
  for (const key of diff.changed) lines.push(`  ~ ${key}`)
  for (const key of diff.removed) lines.push(`  - ${key}`)
  for (const key of diff.globals?.added ?? []) lines.push(`  + ${key} (site content)`)
  for (const key of diff.globals?.changed ?? []) lines.push(`  ~ ${key} (site content)`)
  for (const key of diff.globals?.removed ?? []) lines.push(`  - ${key} (site content)`)
  for (const field of diff.removedFields ?? []) {
    lines.push(`  - field ${field.key} in ${field.owner}${field.site ? ' (site content)' : ''}`)
  }
  for (const language of diff.languages?.added ?? []) lines.push(`  + language ${language}`)
  for (const language of diff.languages?.removed ?? []) lines.push(`  - language ${language}`)
  if (diff.languages?.main) {
    const { from, to } = diff.languages.main
    lines.push(`  ~ main language ${from} -> ${to}`)
  }
  return lines
}

export function formatManifestDiff(diff: ManifestDiff): string {
  const lines = diffLines(diff)
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
  const existingCount = existing
    ? Object.keys(existing.collections).length + Object.keys(existing.globals ?? {}).length
    : 0
  const risks = languageRisks(diff)
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY)
  const current = existsSync(absConfigPath) ? readFileSync(absConfigPath, 'utf8') : undefined
  // A file this command wrote is managed: only removals need a yes. Any other
  // file (hand-written, or from `areca init`) asks before a populated one is replaced.
  const managed = current !== undefined && isGeneratedConfigSource(current)
  const removals = removalsOf(diff)
  const needsConfirm = managed ? removals.length > 0 : existingCount > 0 || risks.length > 0

  let promptShown = false
  if (needsConfirm && options.yes !== true) {
    const subject =
      managed || risks.length > 0 ? capitalize(joinList(managed ? removals : risks)) : undefined
    if (!interactive) {
      throw new Error(
        subject
          ? `${subject} in ${options.configPath}. Re-run with --yes to confirm.`
          : `${options.configPath} already defines ${existingCount} collection(s). Re-run with --yes to overwrite it.`,
      )
    }

    printDiff(options.configPath, diff)
    promptShown = true
    const answer = await confirm({
      message: subject ? `${subject}. Continue?` : `Overwrite ${options.configPath}?`,
      initialValue: false,
    })
    if (isCancel(answer) || answer !== true) {
      throw new ManifestPullCancelledError()
    }
  }

  const source = generateConfigSource({
    siteKey,
    // Local settings survive a re-render; collections and languages come from the CMS.
    ...(existing?.assets !== undefined ? { assets: existing.assets } : {}),
    ...(existing?.i18n !== undefined ? { i18n: existing.i18n } : {}),
    ...(manifest.languages !== undefined ? { languages: manifest.languages } : {}),
    collections: manifest.collections,
    globals: manifest.globals,
  })

  const changed = diffLines(diff).length > 0
  const unchanged = !changed && current === source
  if (!unchanged) {
    if (changed && !promptShown) printDiff(options.configPath, diff)
    writeFileSync(absConfigPath, source, 'utf8')
  }

  return {
    configPath: options.configPath,
    collections: Object.keys(manifest.collections).length,
    diff,
    source,
    unchanged,
  }
}

function printDiff(configPath: string, diff: ManifestDiff): void {
  console.log(`Changes to ${configPath}:`)
  console.log(formatManifestDiff(diff))
}

/** `a`, `a and b`, `a, b and c`. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function normalize(definition: CollectionConfig | GlobalConfig): unknown {
  return JSON.parse(JSON.stringify(definition)) as unknown
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
