export type ParsedArgs =
  | { command: 'pull'; outDir: string; publicationId?: string }
  | { command: 'sync-manifest'; configPath: string }
  | { command: 'manifest-pull'; configPath: string; yes: boolean }
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

  if (command === 'manifest') {
    return parseManifestArgs(rest)
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
  let publicationId: string | undefined

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--out') {
      const value = readFlagValue(args, i, '--out')
      if (value.error) return value.error
      outDir = value.value
      i += 1
      continue
    }
    if (arg === '--publication') {
      const value = readFlagValue(args, i, '--publication')
      if (value.error) return value.error
      publicationId = value.value
      i += 1
      continue
    }
    return { command: 'error', message: `Unknown argument: ${arg}` }
  }

  return {
    command: 'pull',
    outDir,
    ...(publicationId ? { publicationId } : {}),
  }
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

function parseManifestArgs(args: string[]): ParsedArgs {
  const [sub, ...rest] = args

  if (!sub) {
    return {
      command: 'error',
      message: 'Missing manifest subcommand. Expected push or pull.',
    }
  }
  if (sub === 'push') {
    return parseSyncManifestArgs(rest)
  }
  if (sub === 'pull') {
    return parseManifestPullArgs(rest)
  }

  return { command: 'error', message: `Unknown manifest subcommand: ${sub}` }
}

function parseManifestPullArgs(args: string[]): ParsedArgs {
  let configPath = DEFAULT_SYNC_MANIFEST_PATH
  let yes = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
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
    return { command: 'error', message: `Unknown argument: ${arg}` }
  }

  return { command: 'manifest-pull', configPath, yes }
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

  return {
    command: 'init',
    cmsUrl,
    token,
    siteKey,
    outDir,
    configPath,
    yes,
    force,
  }
}

function parseRunArgs(args: string[]): ParsedArgs {
  if (args[0] !== '--' || args.length < 2) {
    return {
      command: 'error',
      message: 'Missing command. Usage: areca run -- <command>',
    }
  }
  return { command: 'run', commandArgs: args.slice(1) }
}

function readFlagValue(
  args: string[],
  index: number,
  flag: string,
):
  | { value: string; error?: undefined }
  | { value?: undefined; error: ParsedArgs } {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    return {
      error: { command: 'error', message: `Missing value for ${flag}` },
    }
  }
  return { value }
}

export function usage(): string {
  return `Usage:
  areca init [--cms-url <url>] [--token <token>] [--site-key <key>] [--out ${DEFAULT_PULL_OUT_DIR}] [--config ${DEFAULT_CONFIG_PATH}] [--yes|-y] [--force]
  areca pull [--out ${DEFAULT_PULL_OUT_DIR}] [--publication <id>]
  areca manifest push [${DEFAULT_SYNC_MANIFEST_PATH}]
  areca manifest pull [--config ${DEFAULT_SYNC_MANIFEST_PATH}] [--yes|-y]
  areca sync-manifest [${DEFAULT_SYNC_MANIFEST_PATH}]   (deprecated alias for manifest push)
  areca run -- <command>

Environment:
  ARECA_CMS_URL      CMS base URL
  ARECA_SITE_TOKEN   Site token sent as Authorization: Bearer <token>
  ARECA_SCHEMA_TOKEN Schema token required for manifest push
  ARECA_SNAPSHOT_ID  Exact publication to pull (empty or 0 selects live content)

Env files (loaded automatically from the current directory; existing process.env keys win):
  .env.local
  .env`
}
