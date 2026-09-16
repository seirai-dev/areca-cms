import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cancel,
  intro,
  isCancel,
  note,
  outro,
  password,
  spinner,
  text,
} from '@clack/prompts'
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_PULL_OUT_DIR,
} from './args.js'
import { parseEnvAssignment } from './env.js'
import type { PulledContentManifest } from './types.js'

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
}

type ResolvedInitValues = {
  cmsUrl: string
  token: string
  siteKey: string
}

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

  const spin = interactive ? spinner() : undefined
  spin?.start('Writing Areca files...')
  try {
    writeSiteFiles(cwd, values, { outDir, configPath, force })
  } catch (error) {
    spin?.stop('Failed to write files')
    throw error
  }
  spin?.stop('Wrote Areca files')

  const nextSteps =
    'Add collections to areca.config.ts → pnpm sync-manifest → publish in CMS → pnpm content:pull → pnpm dev'
  if (interactive) {
    outro(nextSteps)
  } else {
    console.log(`Areca CMS setup complete. ${nextSteps}`)
  }
}

async function promptInitValues(options: InitSiteOptions): Promise<ResolvedInitValues> {
  const cmsUrl = options.cmsUrl
    ? parseCmsUrl(options.cmsUrl)
    : parseCmsUrl(
        requirePrompt(
          await text({
            message: 'CMS URL',
            placeholder: DEFAULT_CMS_URL,
            defaultValue: DEFAULT_CMS_URL,
            validate: (value) => validateCmsUrlInput((value ?? '').trim() || DEFAULT_CMS_URL),
          }),
        ),
      )

  const token = options.token?.trim()
    ? options.token.trim()
    : requirePrompt(
        await password({
          message: 'Site token',
          validate: (value) => ((value ?? '').trim() ? undefined : 'Site token is required'),
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

function writeSiteFiles(
  cwd: string,
  values: ResolvedInitValues,
  options: { outDir: string; configPath: string; force: boolean },
): void {
  const packageJsonPath = join(cwd, 'package.json')
  const pkg = readPackageJson(packageJsonPath)

  writeArecaConfig(join(cwd, options.configPath), values.siteKey, options.force)
  writeEnvExample(join(cwd, '.env.example'), values.cmsUrl, options.force)
  upsertEnvLocal(join(cwd, '.env.local'), {
    ARECA_CMS_URL: values.cmsUrl,
    ARECA_SITE_TOKEN: values.token,
  })
  ensureGitignore(join(cwd, '.gitignore'), ['.env.local', gitignoreOutDir(options.outDir)])
  writeEmptyGeneratedContent(join(cwd, options.outDir))
  writePackageJson(packageJsonPath, patchPackageScripts(pkg, options.outDir))
}

function requireNonInteractiveValues(options: InitSiteOptions): ResolvedInitValues {
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

function writeArecaConfig(filePath: string, siteKey: string, force: boolean): void {
  if (!force && existsSync(filePath)) return
  writeFileSync(
    filePath,
    `import { defineSiteContent } from '@areca/site-sdk'\n\nexport default defineSiteContent({\n  siteKey: '${siteKey}',\n  collections: {},\n})\n`,
    'utf8',
  )
}

function writeEnvExample(filePath: string, cmsUrl: string, force: boolean): void {
  if (!force && existsSync(filePath)) return
  writeFileSync(filePath, `ARECA_CMS_URL=${cmsUrl}\nARECA_SITE_TOKEN=\n`, 'utf8')
}

function upsertEnvLocal(filePath: string, updates: Record<string, string>): void {
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
  return existing.has(entry) || existing.has(trimmed) || existing.has(`${trimmed}/`)
}

function gitignoreOutDir(outDir: string): string {
  return outDir.endsWith('/') ? outDir : `${outDir}/`
}

function writeEmptyGeneratedContent(outDir: string): void {
  mkdirSync(outDir, { recursive: true })
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
      throw new Error(`No package.json found. Run areca init from the site root.`)
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

function patchPackageScripts(pkg: Record<string, unknown>, outDir: string): Record<string, unknown> {
  const scripts =
    pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
      ? { ...(pkg.scripts as Record<string, unknown>) }
      : {}

  setScriptIfEmpty(scripts, 'sync-manifest', 'areca sync-manifest')
  setScriptIfEmpty(scripts, 'content:pull', `areca pull --out ${outDir}`)

  const dev = scripts.dev
  if (typeof dev === 'string' && dev.trim() !== '' && !scriptLoadsEnv(dev)) {
    scripts.dev = `areca run -- ${dev}`
  }

  return { ...pkg, scripts }
}

function setScriptIfEmpty(scripts: Record<string, unknown>, key: string, value: string): void {
  const current = scripts[key]
  if (typeof current !== 'string' || current.trim() === '') {
    scripts[key] = value
  }
}

function scriptLoadsEnv(script: string): boolean {
  return script.includes('--env-file') || script.includes('areca run')
}

function writePackageJson(filePath: string, pkg: Record<string, unknown>): void {
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
