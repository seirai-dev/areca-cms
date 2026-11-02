#!/usr/bin/env node
// Fails when the browser-facing build output contains anything that should only
// exist on the server: secret env var names, their values, connection strings,
// private key material, or Node-only database drivers.
//
//   node scripts/scan-client-bundle.mjs [dir]     (default: .output/public)
//
// Findings report file, line and rule only; matched values are never printed.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Server-only variables. If one of these names shows up in client code, a
// server module (or its env schema) leaked into the browser bundle.
export const SERVER_ENV_NAMES = [
  'DATABASE_URL',
  'REDIS_URL',
  'BETTER_AUTH_SECRET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_ENDPOINT',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_PASSWORD',
  'DOKPLOY_URL',
  'DOKPLOY_API_KEY',
  'DOKPLOY_CREDENTIALS_ENCRYPTION_KEY',
  'CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY',
  'AI_SETTINGS_ENCRYPTION_KEY',
  'SETUP_TOKEN',
  'METRICS_TOKEN',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'DISCORD_CLIENT_SECRET',
  'MICROSOFT_SSO_CLIENT_SECRET',
]

// Not listed on purpose: SMTP_FROM / SMTP_PORT are not secret and the sender
// setting's help text in the UI legitimately names SMTP_FROM.

// Names the UI may print: the Cloudflare notice tells an operator which variable
// to set. Only the name is allowed in client code; the value is still scanned
// through SERVER_ENV_NAMES above.
const NAMED_IN_UI = new Set(['CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY'])

// better-auth's client ships an env reader whose getters merely name
// BETTER_AUTH_SECRET; it reads process.env lazily and holds no value. Minifiers
// may name the reader helper with `$` (e.g. `a$`), so the helper name allows it.
const BENIGN_FRAGMENTS = [
  /get (\w+)\(\)\{return [\w$]+\(`\1`(?:,`[^`]*`)?\)\}/g,
]

// Values shorter than this are ignored to avoid matching "ci", "true", ports.
const MIN_VALUE_LENGTH = 8

const PATTERN_RULES = [
  {
    rule: 'server-env-name',
    // \b treats `_` as a word character, so FOO_DATABASE_URL does not match.
    regex: new RegExp(
      `\\b(?:${SERVER_ENV_NAMES.filter((name) => !NAMED_IN_UI.has(name)).join('|')})\\b`,
    ),
  },
  { rule: 'database-url', regex: /\bpostgres(?:ql)?:\/\/[^\s"'`]+/i },
  { rule: 'redis-url', regex: /\brediss?:\/\/[^\s"'`]+/i },
  { rule: 'private-key', regex: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  {
    rule: 'pg-import',
    regex:
      /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'](?:pg|pg-pool|pg-native|drizzle-orm\/node-postgres)["']/,
  },
  { rule: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
]

/**
 * @param {string} file label used in findings
 * @param {string} content file text
 * @param {Record<string, string | undefined>} [env] environment whose
 *   server-only values must not appear in the content
 * @returns {{ file: string, line: number, rule: string }[]}
 */
export function scanContent(file, content, env = {}) {
  const valueRules = SERVER_ENV_NAMES.flatMap((name) => {
    const value = env[name]
    return value && value.length >= MIN_VALUE_LENGTH
      ? [{ rule: `server-env-value:${name}`, value }]
      : []
  })

  const findings = []
  const seen = new Set()
  const lines = content.split('\n')
  lines.forEach((raw, index) => {
    let text = raw
    for (const fragment of BENIGN_FRAGMENTS) text = text.replace(fragment, '')
    const report = (rule) => {
      const key = `${index}:${rule}`
      if (seen.has(key)) return
      seen.add(key)
      findings.push({ file, line: index + 1, rule })
    }
    for (const { rule, regex } of PATTERN_RULES) {
      if (regex.test(text)) report(rule)
    }
    for (const { rule, value } of valueRules) {
      if (text.includes(value)) report(rule)
    }
  })
  return findings
}

const SCANNED = /\.(?:js|mjs|cjs|css|html|json|map|txt|svg|webmanifest)$/

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (SCANNED.test(entry)) yield path
  }
}

export function scanDirectory(dir, env = process.env) {
  const findings = []
  let files = 0
  for (const path of walk(dir)) {
    files += 1
    findings.push(
      ...scanContent(relative(dir, path), readFileSync(path, 'utf8'), env),
    )
  }
  return { files, findings }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = resolve(
    process.argv[2] ??
      join(dirname(fileURLToPath(import.meta.url)), '../.output/public'),
  )
  let result
  try {
    result = scanDirectory(dir)
  } catch (error) {
    console.error(`cannot read ${dir}: ${error.message}. Build the CMS first.`)
    process.exit(2)
  }
  if (result.files === 0) {
    console.error(
      `no scannable files in ${dir}; refusing to pass an empty scan`,
    )
    process.exit(2)
  }
  if (result.findings.length > 0) {
    console.error(`client bundle leaks server-only material (${dir}):`)
    for (const f of result.findings) {
      console.error(`  ${f.file}:${f.line}  ${f.rule}`)
    }
    process.exit(1)
  }
  console.log(`client bundle clean: ${result.files} files scanned in ${dir}`)
}
