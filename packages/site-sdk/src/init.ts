import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, posix } from 'node:path'
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  spinner,
  text,
} from '@clack/prompts'
import {
  DEFAULT_ASSETS_DIR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_PULL_OUT_DIR,
} from './args.js'
import { derivePublicPath, normalizePublicPath } from './assets.js'
import { parseEnvAssignment } from './env.js'
import { assetsConfigLines } from './generate-config.js'
import { loadConfig } from './load-config.js'
import type { AssetsConfig, PulledContentManifest } from './types.js'

const SITE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULT_CMS_URL = 'http://localhost:3000'

export class InitCancelledError extends Error {
  constructor() {
    super('Operation cancelled.')
    this.name = 'InitCancelledError'
  }
}

export type InitSiteOptions = {
  cwd?: string
  cmsUrl?: string
  token?: string
  siteKey?: string
  outDir?: string
  configPath?: string
  yes?: boolean
  force?: boolean
  /** Media directory for `areca pull` (default `public/areca`). */
  assetsDir?: string
  /** URL path that serves `assetsDir`; needed outside `public/`. */
  assetsPublicPath?: string
  /** Keep media URLs pointing at the CMS. */
  noAssets?: boolean
}

type ResolvedInitValues = {
  cmsUrl: string
  token: string
  siteKey: string
}

/** `keep` leaves an existing `assets` block in areca.config.ts untouched. */
type AssetsChoice = AssetsConfig | 'keep'

export async function initSite(options: InitSiteOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const outDir = options.outDir ?? DEFAULT_PULL_OUT_DIR
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH
  const force = options.force === true
  const interactive = options.yes !== true && Boolean(process.stdin.isTTY)

  if (interactive) {
    intro('Areca CMS')
    note(
      'Wire this frontend to an existing CMS site. You need the site token from the CMS (shown once at create/rotate).',
    )
  }

  const values = interactive
    ? await promptInitValues(options)
    : requireNonInteractiveValues(options)

  const configFile = join(cwd, configPath)
  const existingSource =
    !force && existsSync(configFile) ? readFileSync(configFile, 'utf8') : undefined
  const assets = await chooseAssets(options, {
    interactive,
    existing: existingSource !== undefined && hasAssetsBlock(existingSource)
      ? await describeExistingAssets(configFile, cwd, existingSource)
      : undefined,
  })

  const spin = interactive ? spinner() : undefined
  spin?.start('Writing Areca files...')
  let manualSnippet: string | undefined
  try {
    manualSnippet = writeSiteFiles(cwd, values, {
      outDir,
      configPath,
      force,
      assets,
      existingSource,
    })
  } catch (error) {
    spin?.stop('Failed to write files')
    throw error
  }
  spin?.stop('Wrote Areca files')
  if (manualSnippet) {
    const message = `Could not update ${configPath} automatically. Add this inside defineSiteContent({ ... }):\n\n${manualSnippet}`
    if (interactive) log.warn(message)
    else console.warn(message)
  }

  const nextSteps =
    'Set ARECA_SCHEMA_TOKEN from Settings > Developer (keep it out of builds) → add collections to areca.config.ts → pnpm sync-manifest → publish in CMS → pnpm content:pull → pnpm dev'
  if (interactive) {
    outro(nextSteps)
  } else {
    console.log(`Areca CMS setup complete. ${nextSteps}`)
  }
}

async function promptInitValues(
  options: InitSiteOptions,
): Promise<ResolvedInitValues> {
  const cmsUrl = options.cmsUrl
    ? parseCmsUrl(options.cmsUrl)
    : parseCmsUrl(
        requirePrompt(
          await text({
            message: 'CMS URL',
            placeholder: DEFAULT_CMS_URL,
            defaultValue: DEFAULT_CMS_URL,
            validate: (value) =>
              validateCmsUrlInput((value ?? '').trim() || DEFAULT_CMS_URL),
          }),
        ),
      )

  const token = options.token?.trim()
    ? options.token.trim()
    : requirePrompt(
        await password({
          message: 'Site token',
          validate: (value) =>
            (value ?? '').trim() ? undefined : 'Site token is required',
        }),
      ).trim()

  const siteKey = options.siteKey
    ? parseSiteKey(options.siteKey)
    : parseSiteKey(
        requirePrompt(
          await text({
            message: 'Site key (CMS slug)',
            placeholder: 'acme-site',
            validate: (value) => validateSiteKeyInput((value ?? '').trim()),
          }),
        ),
      )

  return { cmsUrl, token, siteKey }
}

/** Returns a snippet to paste when an existing config could not be patched. */
function writeSiteFiles(
  cwd: string,
  values: ResolvedInitValues,
  options: {
    outDir: string
    configPath: string
    force: boolean
    assets: AssetsChoice
    existingSource: string | undefined
  },
): string | undefined {
  const packageJsonPath = join(cwd, 'package.json')
  const pkg = readPackageJson(packageJsonPath)
  const configFile = join(cwd, options.configPath)
  let manualSnippet: string | undefined

  if (options.existingSource === undefined) {
    writeArecaConfig(
      configFile,
      values.siteKey,
      options.assets === 'keep' ? undefined : options.assets,
    )
  } else if (options.assets !== 'keep') {
    const patched = patchAssetsBlock(options.existingSource, options.assets)
    if (patched === undefined) {
      manualSnippet = assetsConfigLines(options.assets, '  ').join('\n')
    } else if (patched !== options.existingSource) {
      writeFileSync(configFile, patched, 'utf8')
    }
  }
  writeEnvExample(join(cwd, '.env.example'), values.cmsUrl, options.force)
  upsertEnvLocal(join(cwd, '.env.local'), {
    ARECA_CMS_URL: values.cmsUrl,
    ARECA_SITE_TOKEN: values.token,
  })
  // Downloaded media is regenerated by every pull, like the content itself.
  const mediaDir =
    options.assets !== 'keep' && options.assets.download !== false
      ? (options.assets.dir ?? DEFAULT_ASSETS_DIR)
      : undefined
  ensureGitignore(join(cwd, '.gitignore'), [
    '.env.local',
    gitignoreOutDir(options.outDir),
    ...(mediaDir ? [gitignoreOutDir(mediaDir)] : []),
  ])
  writeEmptyGeneratedContent(join(cwd, options.outDir))
  writePackageJson(
    packageJsonPath,
    patchPackageScripts(pkg, options.outDir, options.configPath),
  )
  return manualSnippet
}

async function chooseAssets(
  options: InitSiteOptions,
  context: { interactive: boolean; existing: string | undefined },
): Promise<AssetsChoice> {
  if (options.noAssets) return { download: false }
  if (options.assetsDir !== undefined || options.assetsPublicPath !== undefined) {
    return parseAssetsChoice(
      options.assetsDir ?? DEFAULT_ASSETS_DIR,
      options.assetsPublicPath,
    )
  }
  if (!context.interactive) {
    return context.existing !== undefined
      ? 'keep'
      : { download: true, dir: DEFAULT_ASSETS_DIR }
  }

  if (context.existing !== undefined) {
    note(context.existing, 'Current media settings')
    const replace = await confirm({
      message: 'Change the media settings?',
      initialValue: false,
    })
    if (isCancel(replace)) return cancelInit()
    if (!replace) return 'keep'
  }

  const download = await confirm({
    message: 'Download media (images, files) into this repo when pulling content?',
    initialValue: true,
  })
  if (isCancel(download)) return cancelInit()
  if (!download) return { download: false }

  const dir = requirePrompt(
    await text({
      message: 'Media directory',
      placeholder: DEFAULT_ASSETS_DIR,
      defaultValue: DEFAULT_ASSETS_DIR,
      validate: (value) => validateAssetsDir((value ?? '').trim() || DEFAULT_ASSETS_DIR),
    }),
  ).trim() || DEFAULT_ASSETS_DIR
  if (derivePublicPath(dir) !== undefined) return parseAssetsChoice(dir)

  const suggested = `/${posix.basename(dir.replace(/\\/g, '/'))}`
  const publicPath = requirePrompt(
    await text({
      message: `URL path your site serves ${dir} from`,
      placeholder: suggested,
      defaultValue: suggested,
      validate: (value) => validatePublicPath((value ?? '').trim() || suggested),
    }),
  ).trim() || suggested
  return parseAssetsChoice(dir, publicPath)
}

function parseAssetsChoice(dir: string, publicPath?: string): AssetsConfig {
  const trimmed = dir.trim()
  const dirError = validateAssetsDir(trimmed)
  if (dirError) throw new Error(`Invalid media directory: ${trimmed}. ${dirError}`)
  if (publicPath !== undefined) {
    const pathError = validatePublicPath(publicPath)
    if (pathError) throw new Error(`Invalid media URL path: ${publicPath}. ${pathError}`)
    return { download: true, dir: trimmed, publicPath: normalizePublicPath(publicPath) }
  }
  if (derivePublicPath(trimmed) === undefined) {
    throw new Error(
      `${trimmed} is not under public/. Pass --assets-public-path with the URL path your site serves it from.`,
    )
  }
  return { download: true, dir: trimmed }
}

function validateAssetsDir(value: string): string | undefined {
  if (!value) return 'Enter a directory'
  if (isAbsolute(value)) return 'Use a path relative to the project root'
  if (posix.normalize(value.replace(/\\/g, '/')).startsWith('..'))
    return 'The directory must be inside the project'
  return undefined
}

function validatePublicPath(value: string): string | undefined {
  try {
    normalizePublicPath(value)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function cancelInit(): never {
  cancel('Operation cancelled.')
  throw new InitCancelledError()
}

const SITE_KEY_LINE = /^([ \t]*)siteKey\s*:.*,[ \t]*$/m

/** Top-level `assets:` only: a collection named `assets` sits deeper. */
function assetsBlockStart(source: string): RegExp {
  const indent = SITE_KEY_LINE.exec(source)?.[1] ?? '  '
  return new RegExp(`^(${indent})assets\\s*:\\s*`, 'm')
}

function hasAssetsBlock(source: string): boolean {
  return assetsBlockStart(source).test(source)
}

async function describeExistingAssets(
  configFile: string,
  cwd: string,
  source: string,
): Promise<string> {
  try {
    const config = await loadConfig(configFile, cwd)
    if (config.assets) return assetsConfigLines(config.assets, '').join('\n')
  } catch {
    // Show the source text when the config cannot be imported here.
  }
  const range = assetsBlockRange(source)
  return range ? source.slice(range.start, range.end).trim() : 'assets: (custom)'
}

/**
 * Replaces the `assets: { ... }` block, or inserts one after `siteKey`.
 * Returns undefined when the file does not have a shape that can be edited
 * safely (for example `assets: someVariable`).
 */
export function patchAssetsBlock(
  source: string,
  assets: AssetsConfig,
): string | undefined {
  if (hasAssetsBlock(source)) {
    const range = assetsBlockRange(source)
    if (!range) return undefined
    const lines = assetsConfigLines(assets, range.indent).join('\n')
    return `${source.slice(0, range.start)}${lines}${source.slice(range.end)}`
  }
  const siteKey = SITE_KEY_LINE.exec(source)
  if (!siteKey) return undefined
  const insertAt = siteKey.index + siteKey[0].length
  const lines = assetsConfigLines(assets, siteKey[1] ?? '  ').join('\n')
  return `${source.slice(0, insertAt)}\n${lines}${source.slice(insertAt)}`
}

/** The `assets: { ... },` text including indentation and trailing comma. */
function assetsBlockRange(
  source: string,
): { start: number; end: number; indent: string } | undefined {
  const match = assetsBlockStart(source).exec(source)
  if (!match) return undefined
  const open = match.index + match[0].length
  if (source[open] !== '{') return undefined
  let depth = 0
  let quote: string | undefined
  for (let i = open; i < source.length; i += 1) {
    const char = source[i]
    if (quote) {
      if (char === '\\') i += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        let end = i + 1
        if (source[end] === ',') end += 1
        return { start: match.index, end, indent: match[1] ?? '' }
      }
    }
  }
  return undefined
}

function requireNonInteractiveValues(
  options: InitSiteOptions,
): ResolvedInitValues {
  const cmsUrl = options.cmsUrl?.trim() ?? ''
  const token = options.token?.trim() ?? ''
  const siteKey = options.siteKey?.trim() ?? ''
  const missing: string[] = []
  if (!cmsUrl) missing.push('--cms-url')
  if (!token) missing.push('--token')
  if (!siteKey) missing.push('--site-key')
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')}. Pass --cms-url, --token, and --site-key, or run areca init in a terminal to enter them interactively.`,
    )
  }

  return {
    cmsUrl: parseCmsUrl(cmsUrl),
    token,
    siteKey: parseSiteKey(siteKey),
  }
}

function parseCmsUrl(value: string): string {
  const trimmed = value.trim()
  const error = validateCmsUrlInput(trimmed)
  if (error) {
    throw new Error(`Invalid CMS URL: ${trimmed}. ${error}`)
  }
  return new URL(trimmed).toString().replace(/\/+$/, '')
}

function parseSiteKey(value: string): string {
  const trimmed = value.trim()
  const error = validateSiteKeyInput(trimmed)
  if (error) {
    throw new Error(`Invalid site key: ${trimmed}. ${error}`)
  }
  return trimmed
}

function validateCmsUrlInput(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Enter a valid http(s) URL'
    }
  } catch {
    return 'Enter a valid URL'
  }
  return undefined
}

function validateSiteKeyInput(value: string): string | undefined {
  if (!SITE_KEY_PATTERN.test(value)) {
    return 'Use a lowercase slug like acme-site (letters, numbers, hyphens)'
  }
  return undefined
}

function requirePrompt(value: string | symbol): string {
  if (isCancel(value) || typeof value !== 'string') {
    cancel('Operation cancelled.')
    throw new InitCancelledError()
  }
  return value
}

function writeArecaConfig(
  filePath: string,
  siteKey: string,
  assets: AssetsConfig | undefined,
): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const assetsLines = assets ? `${assetsConfigLines(assets, '  ').join('\n')}\n` : ''
  writeFileSync(
    filePath,
    `import { defineSiteContent } from '@areca-cms/site-sdk'\n\nexport default defineSiteContent({\n  siteKey: '${siteKey}',\n${assetsLines}  collections: {},\n})\n`,
    'utf8',
  )
}

function writeEnvExample(
  filePath: string,
  cmsUrl: string,
  force: boolean,
): void {
  if (!force && existsSync(filePath)) return
  writeFileSync(
    filePath,
    `ARECA_CMS_URL=${cmsUrl}\nARECA_SITE_TOKEN=\nARECA_SCHEMA_TOKEN=\n`,
    'utf8',
  )
}

function upsertEnvLocal(
  filePath: string,
  updates: Record<string, string>,
): void {
  const original = readOptionalUtf8(filePath) ?? ''
  const lines = original.length > 0 ? original.split(/\r?\n/) : []
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const seen = new Set<string>()
  const next: string[] = []

  for (const line of lines) {
    const parsed = parseEnvAssignment(line)
    if (parsed && Object.hasOwn(updates, parsed.key)) {
      next.push(`${parsed.key}=${updates[parsed.key]}`)
      seen.add(parsed.key)
    } else {
      next.push(line)
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      next.push(`${key}=${value}`)
    }
  }

  writeFileSync(filePath, `${next.join('\n')}\n`, 'utf8')
}

function ensureGitignore(filePath: string, entries: string[]): void {
  const original = readOptionalUtf8(filePath) ?? ''
  const existing = new Set(
    original
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  )

  const toAdd = entries.filter((entry) => !hasGitignoreEntry(existing, entry))
  if (toAdd.length === 0) {
    if (original.length === 0) writeFileSync(filePath, '', 'utf8')
    return
  }

  const prefix = original.length > 0 && !original.endsWith('\n') ? '\n' : ''
  writeFileSync(filePath, `${original}${prefix}${toAdd.join('\n')}\n`, 'utf8')
}

function hasGitignoreEntry(existing: Set<string>, entry: string): boolean {
  const trimmed = entry.replace(/\/+$/, '')
  return (
    existing.has(entry) || existing.has(trimmed) || existing.has(`${trimmed}/`)
  )
}

function gitignoreOutDir(outDir: string): string {
  return outDir.endsWith('/') ? outDir : `${outDir}/`
}

function writeEmptyGeneratedContent(outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  if (existsSync(join(outDir, 'manifest.json'))) return
  const manifest: PulledContentManifest = {
    publicationId: '',
    hash: '',
    createdAt: '',
    collections: {},
  }
  writeJson(join(outDir, 'manifest.json'), manifest)
}

function readPackageJson(filePath: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(
        `No package.json found. Run areca init from the site root.`,
      )
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in package.json.`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid package.json. Expected a JSON object.`)
  }

  return parsed as Record<string, unknown>
}

function patchPackageScripts(
  pkg: Record<string, unknown>,
  outDir: string,
  configPath: string,
): Record<string, unknown> {
  const scripts =
    pkg.scripts &&
    typeof pkg.scripts === 'object' &&
    !Array.isArray(pkg.scripts)
      ? { ...(pkg.scripts as Record<string, unknown>) }
      : {}

  setScriptIfEmpty(
    scripts,
    'sync-manifest',
    `areca manifest push${configPath === DEFAULT_CONFIG_PATH ? '' : ` ${shellArgument(configPath)}`}`,
  )
  setScriptIfEmpty(
    scripts,
    'content:pull',
    `areca pull --out ${shellArgument(outDir)}`,
  )

  const dev = scripts.dev
  if (typeof dev === 'string' && dev.trim() !== '' && !scriptLoadsEnv(dev)) {
    scripts.dev = `areca run -- ${dev}`
  }

  return { ...pkg, scripts }
}

function shellArgument(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

function setScriptIfEmpty(
  scripts: Record<string, unknown>,
  key: string,
  value: string,
): void {
  const current = scripts[key]
  if (typeof current !== 'string' || current.trim() === '') {
    scripts[key] = value
  }
}

function scriptLoadsEnv(script: string): boolean {
  return script.includes('--env-file') || script.includes('areca run')
}

function writePackageJson(
  filePath: string,
  pkg: Record<string, unknown>,
): void {
  writeJson(filePath, pkg)
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readOptionalUtf8(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
