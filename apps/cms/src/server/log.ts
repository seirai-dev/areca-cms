/**
 * Structured JSON-line logger with secret redaction.
 *
 * Server-only. Every operational log line (worker, scheduler, adapters, rate
 * limiter, error middleware) goes through here so that credentials never reach
 * stdout/stderr, build logs, audit metadata or UI-visible errors.
 *
 * Output: one JSON object per line
 *   {"level":"error","time":"...","component":"worker","msg":"...", ...fields}
 * info/debug go to stdout, warn/error to stderr. `LOG_LEVEL` (debug|info|warn|
 * error|silent, default info) filters.
 */

import { currentRequestId } from './http/request-scope.server'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type Threshold = LogLevel | 'silent'

const LEVEL_RANK: Record<Threshold, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

const REDACTED = '[redacted]'
const MIN_SECRET_LENGTH = 6
const MAX_STRING_LENGTH = 4000
const MAX_REDACT_INPUT = 32 * 1024
const MAX_STACK_LINES = 12
const MAX_DEPTH = 4

/** Env var names whose values are treated as secrets. */
const SECRET_ENV_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|ENCRYPTION_KEY|CREDENTIAL|SMTP_USER|SMTP_PASS)/i
/** Env vars holding URLs that may embed credentials. */
const URL_ENV_NAME = /(_URL|_URI|_DSN)$/i

const SENSITIVE_KEY =
  /(secret|token|password|passwd|pwd|api[-_]?key|apikey|authorization|credential|private[-_]?key|cookie|signature|access[-_]?key)/i

/** Secret values currently configured in the process environment. */
export function collectSecretValues(
  source: Record<string, string | undefined> = process.env,
): string[] {
  const values = new Set<string>()
  const add = (value: string | undefined | null) => {
    if (value && value.length >= MIN_SECRET_LENGTH) values.add(value)
  }
  for (const [name, value] of Object.entries(source)) {
    if (!value) continue
    if (SECRET_ENV_NAME.test(name)) add(value)
    if (URL_ENV_NAME.test(name)) {
      try {
        const url = new URL(value)
        if (url.password) {
          add(url.password)
          add(decodeURIComponent(url.password))
        }
      } catch {
        // not a URL
      }
    }
  }
  // Longest first so a secret that contains another one is replaced whole.
  return [...values].sort((a, b) => b.length - a.length)
}

const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi
const AUTH_HEADER =
  /(["']?\bauthorization["']?\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?["']?[^\s"',;]+/gi
const API_KEY_HEADER = /(["']?\bx-api-key["']?\s*[:=]\s*)["']?[^\s"',;]+["']?/gi
// key=value / "key": "value" where the key looks sensitive.
const SENSITIVE_PAIR = new RegExp(
  `(?<![\\w.-])(["']?[\\w.-]*(?:${SENSITIVE_KEY.source})[\\w.-]*["']?\\s*[:=]\\s*["']?)([^\\s"',;&}\\]]{3,})`,
  'gi',
)
// Any key whose value is a long base64/hex/url-safe token.
const LONG_TOKEN_PAIR =
  /((?<![\w.-])[\w.-]+\s*=\s*["']?)([A-Za-z0-9+/_-]{24,}={0,2})(?=["'\s&;,]|$)/g

/** Scrub secrets out of an arbitrary string. */
export function redactString(
  input: string,
  secrets: readonly string[] = collectSecretValues(),
): string {
  // Bound the work done by the regexes below; nothing useful lives past this.
  let out =
    input.length > MAX_REDACT_INPUT
      ? `${input.slice(0, MAX_REDACT_INPUT)}…[+${input.length - MAX_REDACT_INPUT} chars]`
      : input
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED)
  }
  out = out.replace(URL_USERINFO, `$1${REDACTED}@`)
  out = out.replace(AUTH_HEADER, `$1${REDACTED}`)
  out = out.replace(API_KEY_HEADER, `$1${REDACTED}`)
  out = out.replace(BEARER, `$1 ${REDACTED}`)
  out = out.replace(SENSITIVE_PAIR, (match, prefix: string, value: string) =>
    value === REDACTED || value.startsWith('[redacted')
      ? match
      : prefix + REDACTED,
  )
  out = out.replace(LONG_TOKEN_PAIR, `$1${REDACTED}`)
  return out
}

export function truncate(value: string, max = MAX_STRING_LENGTH) {
  return value.length > max
    ? `${value.slice(0, max)}…[+${value.length - max}]`
    : value
}

export type SerializedError = {
  name: string
  message: string
  code?: string | number
  stack?: string
  cause?: unknown
}

/** Redacted, bounded representation of any thrown value. */
export function redactError(
  error: unknown,
  secrets: readonly string[] = collectSecretValues(),
  depth = 0,
): SerializedError {
  if (error instanceof Error) {
    const record = error as Error & { code?: unknown; cause?: unknown }
    const out: SerializedError = {
      name: error.name,
      message: truncate(redactString(error.message, secrets)),
    }
    if (typeof record.code === 'string' || typeof record.code === 'number') {
      out.code = record.code
    }
    if (error.stack) {
      out.stack = truncate(
        redactString(error.stack, secrets)
          .split('\n')
          .slice(0, MAX_STACK_LINES)
          .join('\n'),
        8000,
      )
    }
    if (record.cause !== undefined && depth < 2) {
      out.cause = redactError(record.cause, secrets, depth + 1)
    }
    return out
  }
  return {
    name: 'NonError',
    message: truncate(
      redactString(
        typeof error === 'string' ? error : safeStringify(error),
        secrets,
      ),
    ),
  }
}

function safeStringify(value: unknown) {
  try {
    // JSON.stringify returns undefined for undefined, functions and symbols.
    const json = JSON.stringify(value) as string | undefined
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

/** Redact an arbitrary log field value, recursively and with bounded depth. */
export function redactValue(
  value: unknown,
  secrets: readonly string[] = collectSecretValues(),
  depth = 0,
  key?: string,
): unknown {
  if (key && SENSITIVE_KEY.test(key) && value != null && value !== '') {
    return REDACTED
  }
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'string') return truncate(redactString(value, secrets))
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) return redactError(value, secrets)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (depth >= MAX_DEPTH) return '[depth limit]'
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => redactValue(item, secrets, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(
    0,
    50,
  )) {
    out[k] = redactValue(v, secrets, depth + 1, k)
  }
  return out
}

export type LogSink = (level: LogLevel, line: string) => void

const defaultSink: LogSink = (level, line) => {
  const stream =
    level === 'warn' || level === 'error' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

let sink: LogSink = defaultSink

/** Test seam: replace where lines go. Returns a restore function. */
export function setLogSink(next: LogSink | null) {
  const previous = sink
  sink = next ?? defaultSink
  return () => {
    sink = previous
  }
}

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Threshold
  const rank = LEVEL_RANK[raw] as number | undefined
  return rank ?? LEVEL_RANK.info
}

const RESERVED = new Set(['level', 'time', 'component', 'msg'])

export type Logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => void
  info: (msg: string, fields?: Record<string, unknown>) => void
  warn: (msg: string, fields?: Record<string, unknown>) => void
  error: (msg: string, fields?: Record<string, unknown>) => void
  child: (component: string) => Logger
}

export function createLogger(component: string): Logger {
  const emit = (
    level: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ) => {
    if (LEVEL_RANK[level] < threshold()) return
    const secrets = collectSecretValues()
    const line: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      component,
      msg: truncate(redactString(msg, secrets)),
    }
    const requestId = currentRequestId()
    if (requestId) line.requestId = requestId
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue
        line[RESERVED.has(key) ? `field_${key}` : key] = redactValue(
          value,
          secrets,
          0,
          key,
        )
      }
    }
    try {
      sink(level, JSON.stringify(line))
    } catch {
      // Logging must never throw into request paths.
    }
  }
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (name) => createLogger(`${component}.${name}`),
  }
}

/** Short opaque reference shown to users and logged next to the real error. */
export function newErrorRef() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10)
}

export { REDACTED }
