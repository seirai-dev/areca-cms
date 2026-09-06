export type ParsedArgs =
  | { command: 'pull'; outDir: string }
  | { command: 'sync-manifest'; configPath: string }
  | { command: 'help' }
  | { command: 'error'; message: string }

export const DEFAULT_PULL_OUT_DIR = 'src/generated/content'

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
    const configPath = rest[0]
    if (!configPath || configPath.startsWith('-')) {
      return { command: 'error', message: 'Missing path to config module. Usage: areca sync-manifest <path-to-config-module>' }
    }
    return { command: 'sync-manifest', configPath }
  }

  return { command: 'error', message: `Unknown command: ${command}` }
}

function parsePullArgs(args: string[]): ParsedArgs {
  let outDir = DEFAULT_PULL_OUT_DIR

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--out') {
      const value = args[i + 1]
      if (!value || value.startsWith('-')) {
        return { command: 'error', message: 'Missing value for --out' }
      }
      outDir = value
      i += 1
      continue
    }
    return { command: 'error', message: `Unknown argument: ${arg}` }
  }

  return { command: 'pull', outDir }
}

export function usage(): string {
  return `Usage:
  areca pull [--out ${DEFAULT_PULL_OUT_DIR}]
  areca sync-manifest <path-to-config-module>

Environment:
  ARECA_CMS_URL      CMS base URL
  ARECA_SITE_TOKEN   Site token sent as Authorization: Bearer <token>

TypeScript config modules must be loaded with tsx, e.g.
  pnpm exec tsx ./node_modules/@areca/site-sdk/dist/cli.js sync-manifest ./areca.config.ts`
}
