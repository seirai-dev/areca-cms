import { env } from '#/env'

/**
 * Key that encrypts stored secrets (SMTP password, reset tokens). Prefers
 * SECRETS_ENCRYPTION_KEY and falls back to the AI settings key, so existing
 * installs keep working without a new variable.
 */
export function secretsEncryptionKey(): string | null {
  return env.SECRETS_ENCRYPTION_KEY ?? env.AI_SETTINGS_ENCRYPTION_KEY ?? null
}

/** Name of the variable that supplies the key, for setup copy in the UI. */
export function secretsEncryptionKeyEnvName():
  'SECRETS_ENCRYPTION_KEY' | 'AI_SETTINGS_ENCRYPTION_KEY' {
  if (env.SECRETS_ENCRYPTION_KEY) return 'SECRETS_ENCRYPTION_KEY'
  if (env.AI_SETTINGS_ENCRYPTION_KEY) return 'AI_SETTINGS_ENCRYPTION_KEY'
  return 'SECRETS_ENCRYPTION_KEY'
}
