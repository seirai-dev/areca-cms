import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  secretsEncryptionKey,
  secretsEncryptionKeyEnvName,
} from './secrets-key.ts'

const state: { env: Record<string, string | undefined> } = vi.hoisted(() => ({
  env: {},
}))

vi.mock('#/env', () => ({ env: state.env }))

const primary = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='
const fallback = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI='

describe('secretsEncryptionKey', () => {
  beforeEach(() => {
    for (const name of Object.keys(state.env)) delete state.env[name]
  })

  it('prefers SECRETS_ENCRYPTION_KEY over the AI settings key', () => {
    state.env.SECRETS_ENCRYPTION_KEY = primary
    state.env.AI_SETTINGS_ENCRYPTION_KEY = fallback
    expect(secretsEncryptionKey()).toBe(primary)
    expect(secretsEncryptionKeyEnvName()).toBe('SECRETS_ENCRYPTION_KEY')
  })

  it('falls back to the AI settings key', () => {
    state.env.AI_SETTINGS_ENCRYPTION_KEY = fallback
    expect(secretsEncryptionKey()).toBe(fallback)
    expect(secretsEncryptionKeyEnvName()).toBe('AI_SETTINGS_ENCRYPTION_KEY')
  })

  it('returns null and names the preferred variable when neither is set', () => {
    expect(secretsEncryptionKey()).toBeNull()
    expect(secretsEncryptionKeyEnvName()).toBe('SECRETS_ENCRYPTION_KEY')
  })
})
