export type ParsedArgs =
  | { command: 'pull'; outDir: string }
  | { command: 'sync-manifest'; configPath: string }
  | {
      command: 'init'
      cmsUrl?: string
      token?: string
      siteKey?: string
      outDir: string
      configPath: string
      yes: boolean
      force: boolean
    }
  | { command: 'run'; commandArgs: string[] }
  | { command: 'help' }
  | { command: 'error'; message: string }

export const DEFAULT_PULL_OUT_DIR = 'src/generated/content'
export const DEFAULT_CONFIG_PATH = 'areca.config.ts'
export const DEFAULT_SYNC_MANIFEST_PATH = './areca.config.ts'

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.filter((arg) => arg.length > 0)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return { command: 'help' }
  }

  const [command, ...rest] = args

  if (command === 'pull') {
    return parsePullArgs(rest)
  }

  if (command === 'sync-manifest') {
    return parseSyncManifestArgs(rest)
  }

  if (command === 'init') {
    return parseInitArgs(rest)
  }

  if (command === 'run') {
    return parseRunArgs(rest)
  }

  return { command: 'error', message: `Unknown command: ${command}` }
}

function parsePullArgs(args: string[]): ParsedArgs {
  let outDir = DEFAULT_PULL_OUT_DIR

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--out') {
      const value = readFlagValue(args, i, '--out')
      if (value.error) return value.error
      outDir = value.value
      i += 1
      continue
    }
    return { command: 'error', message: `Unknown argument: ${arg}` }
  }

  return { command: 'pull', outDir }
}

function parseSyncManifestArgs(args: string[]): ParsedArgs {
  const configPath = args[0]
  if (!configPath) {
    return { command: 'sync-manifest', configPath: DEFAULT_SYNC_MANIFEST_PATH }
  }
  if (configPath.startsWith('-')) {
    return { command: 'error', message: `Unknown argument: ${configPath}` }
  }
  return { command: 'sync-manifest', configPath }
}

function parseInitArgs(args: string[]): ParsedArgs {
  let cmsUrl: string | undefined
  let token: string | undefined
  let siteKey: string | undefined
  let outDir = DEFAULT_PULL_OUT_DIR
  let configPath = DEFAULT_CONFIG_PATH
  let yes = false
  let force = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--cms-url') {
      const value = readFlagValue(args, i, '--cms-url')
      if (value.error) return value.error
      cmsUrl = value.value
      i += 1
      continue
    }
    if (arg === '--token') {
      const value = readFlagValue(args, i, '--token')
      if (value.error) return value.error
      token = value.value
      i += 1
      continue
    }
    if (arg === '--site-key') {
      const value = readFlagValue(args, i, '--site-key')
      if (value.error) return value.error
      siteKey = value.value
      i += 1
      continue
    }
    if (arg === '--out') {
      const value = readFlagValue(args, i, '--out')
      if (value.error) return value.error
      outDir = value.value
      i += 1
      continue
    }
    if (arg === '--config') {
      const value = readFlagValue(args, i, '--config')
      if (value.error) return value.error
      configPath = value.value
      i += 1
      continue
    }
    if (arg === '--yes' || arg === '-y') {
      yes = true
      continue
    }
    if (arg === '--force') {
      force = true
      continue
    }
    return { command: 'error', message: `Unknown argument: ${arg}` }
  }

  return { command: 'init', cmsUrl, token, siteKey, outDir, configPath, yes, force }
}

function parseRunArgs(args: string[]): ParsedArgs {
  if (args[0] !== '--' || args.length < 2) {
    return { command: 'error', message: 'Missing command. Usage: areca run -- <command>' }
  }
  return { command: 'run', commandArgs: args.slice(1) }
}

function readFlagValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; error?: undefined } | { value?: undefined; error: ParsedArgs } {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    return { error: { command: 'error', message: `Missing value for ${flag}` } }
  }
  return { value }
}

export function usage(): string {
  return `Usage:
  areca init [--cms-url <url>] [--token <token>] [--site-key <key>] [--out ${DEFAULT_PULL_OUT_DIR}] [--config ${DEFAULT_CONFIG_PATH}] [--yes|-y] [--force]
  areca pull [--out ${DEFAULT_PULL_OUT_DIR}]
  areca sync-manifest [${DEFAULT_SYNC_MANIFEST_PATH}]
  areca run -- <command>

Environment:
  ARECA_CMS_URL      CMS base URL
  ARECA_SITE_TOKEN   Site token sent as Authorization: Bearer <token>

Env files (loaded automatically from the current directory; existing process.env keys win):
  .env.local
  .env`
}
