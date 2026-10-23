/**
 * Startup checks for secrets copied from example env files. Those values are
 * public, so a production instance that keeps one can be forged or decrypted
 * by anyone who reads the example. Only consulted in production; see env.ts.
 */

/** Values from `.env.example` files, and the template placeholders in them. */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set(['change-me'])
const PLACEHOLDER_PATTERN = /^replace[-_]/i

export const GENERATE_SECRET_HINT =
  'Generate one with: openssl rand -base64 32 (or openssl rand -hex 32 for BETTER_AUTH_SECRET)'

export function isPlaceholderSecret(value: string) {
  return (
    PLACEHOLDER_SECRETS.has(value.trim().toLowerCase()) ||
    PLACEHOLDER_PATTERN.test(value.trim())
  )
}

/** A base64 32-byte key made only of zero bytes (the `AAAA…=` example). */
export function isAllZeroKey(base64Key: string) {
  const bytes = Buffer.from(base64Key, 'base64')
  return bytes.length > 0 && bytes.every((byte) => byte === 0)
}

/** The encryption keys that must not be all-zero. */
const ENCRYPTION_KEY_NAMES = [
  'DOKPLOY_CREDENTIALS_ENCRYPTION_KEY',
  'AI_SETTINGS_ENCRYPTION_KEY',
  'SECRETS_ENCRYPTION_KEY',
] as const

/**
 * Human-readable problems with the production secrets. Empty when every
 * supplied secret is real. Unset optional keys are not checked. Callers may
 * pass the whole parsed env: only the named secrets are read from it.
 */
export function productionSecretProblems(secrets: {
  BETTER_AUTH_SECRET?: string
  DOKPLOY_CREDENTIALS_ENCRYPTION_KEY?: string
  AI_SETTINGS_ENCRYPTION_KEY?: string
  SECRETS_ENCRYPTION_KEY?: string
}) {
  const problems: string[] = []
  const authSecret = secrets.BETTER_AUTH_SECRET
  if (authSecret && isPlaceholderSecret(authSecret)) {
    problems.push(
      `BETTER_AUTH_SECRET is still a placeholder. ${GENERATE_SECRET_HINT}`,
    )
  }
  for (const name of ENCRYPTION_KEY_NAMES) {
    const value = secrets[name]
    if (value && isAllZeroKey(value)) {
      problems.push(`${name} is an all-zero key. ${GENERATE_SECRET_HINT}`)
    }
  }
  return problems
}
