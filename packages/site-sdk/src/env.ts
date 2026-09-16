import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadLocalEnv(cwd = process.cwd()): string[] {
  const loaded: string[] = []

  for (const name of ['.env.local', '.env'] as const) {
    const filePath = join(cwd, name)
    const content = readOptionalFile(filePath)
    if (content === undefined) continue
    applyEnv(parseEnv(content))
    loaded.push(filePath)
  }

  return loaded
}

function parseEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvAssignment(line)
    if (!parsed) continue
    values[parsed.key] = parsed.value
  }

  return values
}

export function parseEnvAssignment(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return undefined

  const eq = trimmed.indexOf('=')
  if (eq <= 0) return undefined

  const key = trimmed.slice(0, eq).trim()
  if (!key) return undefined

  return { key, value: unquote(trimmed.slice(eq + 1)) }
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const start = value[0]
    const end = value[value.length - 1]
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function applyEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function readOptionalFile(filePath: string): string | undefined {
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
