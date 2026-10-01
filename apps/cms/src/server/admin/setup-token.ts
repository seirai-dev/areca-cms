import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

let generated: string | null = null

/**
 * The token that protects first-run setup, or null when none applies.
 *
 * A configured `SETUP_TOKEN` always wins. Otherwise, while the instance still
 * needs setup, a random token is generated once per process and logged once so
 * the operator can read it from the server output. Once setup is done there
 * is nothing to protect and no token is produced. This only runs from request
 * handlers, never at import time, so `vite build` stays silent.
 */
export function resolveSetupToken(
  configured: string | undefined,
  needsSetup: boolean,
  log: (message: string) => void = console.info,
): string | null {
  if (configured) return configured
  if (!needsSetup) {
    generated = null
    return null
  }
  if (!generated) {
    generated = randomBytes(24).toString('base64url')
    log(
      `[setup] First-run setup token: ${generated}\n` +
        '[setup] Enter it on /setup to create the first admin account. ' +
        'Set SETUP_TOKEN (16+ characters) to use a fixed value instead.',
    )
  }
  return generated
}

/** Constant-time comparison over fixed-length digests. */
export function setupTokenMatches(
  provided: string | undefined,
  expected: string | null,
) {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  // With nothing to compare against, still do the work and always fail.
  const left = digest(provided ?? '')
  const right = expected === null ? randomBytes(32) : digest(expected)
  return timingSafeEqual(left, right) && expected !== null && Boolean(provided)
}

export function resetGeneratedSetupToken() {
  generated = null
}
