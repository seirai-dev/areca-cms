import { describe, expect, it } from 'vitest'

import type { MailSettingsRow } from './config.ts'
import {
  chooseMailSource,
  pickMailConfig,
  readEnvMail,
  validateMailConfig,
} from './config.ts'

const now = new Date('2026-10-21T10:00:00Z')

function row(overrides: Partial<MailSettingsRow> = {}): MailSettingsRow {
  return {
    id: 'default',
    enabled: true,
    host: 'smtp.example.com',
    port: 587,
    secure: 'starttls',
    username: 'cms',
    encryptedPassword: 'v1.encrypted',
    fromAddress: 'cms@example.com',
    replyTo: null,
    lastVerifiedAt: null,
    updatedBy: null,
    updatedAt: now,
    ...overrides,
  }
}

const envValues = {
  SMTP_HOST: 'mailpit',
  SMTP_PORT: 1025,
  SMTP_FROM: 'env@areca.local',
}

describe('readEnvMail', () => {
  it('needs host, port and from', () => {
    expect(readEnvMail({ SMTP_HOST: 'mailpit', SMTP_PORT: 1025 })).toBeNull()
    expect(
      readEnvMail({ SMTP_HOST: 'mailpit', SMTP_FROM: 'a@b.co' }),
    ).toBeNull()
    expect(readEnvMail({ SMTP_PORT: 1025, SMTP_FROM: 'a@b.co' })).toBeNull()
  })

  it('defaults encryption from the host and keeps optional values', () => {
    expect(readEnvMail(envValues)).toEqual({
      host: 'mailpit',
      port: 1025,
      secure: 'none',
      username: null,
      password: null,
      from: 'env@areca.local',
      replyTo: null,
    })
    expect(
      readEnvMail({
        ...envValues,
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'cms',
        SMTP_PASSWORD: 'pw-123456',
        SMTP_REPLY_TO: 'help@example.com',
      }),
    ).toMatchObject({
      secure: 'starttls',
      username: 'cms',
      password: 'pw-123456',
      replyTo: 'help@example.com',
    })
  })
})

describe('chooseMailSource and pickMailConfig precedence', () => {
  const envMail = readEnvMail(envValues)

  it('prefers enabled and complete settings over the environment', () => {
    expect(chooseMailSource(row(), envMail)).toBe('settings')
    const config = pickMailConfig(
      row(),
      envMail,
      (encrypted) => `decrypted:${encrypted}`,
    )
    expect(config).toEqual({
      source: 'settings',
      host: 'smtp.example.com',
      port: 587,
      secure: 'starttls',
      username: 'cms',
      password: 'decrypted:v1.encrypted',
      from: 'cms@example.com',
      replyTo: null,
    })
  })

  it('uses the environment when settings are disabled', () => {
    const disabled = row({ enabled: false })
    expect(chooseMailSource(disabled, envMail)).toBe('env')
    expect(pickMailConfig(disabled, envMail, () => 'never')).toMatchObject({
      source: 'env',
      host: 'mailpit',
      port: 1025,
      secure: 'none',
      password: null,
    })
  })

  it('falls back to the environment when settings are incomplete', () => {
    const incomplete = row({ fromAddress: null })
    expect(chooseMailSource(incomplete, envMail)).toBe('env')
    expect(pickMailConfig(incomplete, envMail, () => 'never')?.source).toBe(
      'env',
    )
  })

  it('returns nothing when neither source is configured', () => {
    expect(chooseMailSource(row({ enabled: false }), null)).toBeNull()
    expect(pickMailConfig(null, null, () => 'never')).toBeNull()
  })

  it('sends without a password when none is stored', () => {
    const config = pickMailConfig(
      row({ encryptedPassword: null }),
      null,
      () => 'never',
    )
    expect(config?.password).toBeNull()
  })
})

describe('validateMailConfig', () => {
  const valid = {
    host: 'smtp.example.com',
    port: 587,
    secure: 'starttls' as const,
    from: '"Areca" <cms@example.com>',
    replyTo: 'help@example.com',
  }

  it('accepts a complete configuration', () => {
    expect(validateMailConfig(valid)).toEqual([])
  })

  it('reports each invalid field', () => {
    const paths = validateMailConfig({
      host: '  ',
      port: 0,
      secure: 'starttls',
      from: 'not an email',
      replyTo: 'nope',
    }).map((problem) => problem.path)
    expect(paths).toEqual(['host', 'port', 'from', 'replyTo'])
    expect(
      validateMailConfig({ ...valid, port: 70_000 }).map((p) => p.path),
    ).toEqual(['port'])
    expect(
      validateMailConfig({ ...valid, port: 1.5 }).map((p) => p.path),
    ).toEqual(['port'])
  })

  it('rejects unencrypted SMTP to a public host', () => {
    const problems = validateMailConfig({ ...valid, secure: 'none' })
    expect(problems).toEqual([expect.objectContaining({ path: 'secure' })])
  })

  it('allows unencrypted SMTP to a private host', () => {
    expect(
      validateMailConfig({ ...valid, host: 'mailpit', secure: 'none' }),
    ).toEqual([])
  })
})
