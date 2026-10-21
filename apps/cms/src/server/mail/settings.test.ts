import { describe, expect, it } from 'vitest'

import type { EnvMail, MailSettingsRow } from './config.ts'
import { draftPassword, mailSettingsStatus } from './settings.ts'

const SECRET = 'stored-password-value'
const ENV_SECRET = 'env-password-value'

const row: MailSettingsRow = {
  id: 'default',
  enabled: true,
  host: 'smtp.example.com',
  port: 587,
  secure: 'starttls',
  username: 'cms',
  encryptedPassword: `v1.iv.tag.${SECRET}`,
  fromAddress: 'cms@example.com',
  replyTo: null,
  lastVerifiedAt: null,
  updatedBy: null,
  updatedAt: new Date('2026-10-21T10:00:00Z'),
}

const envMail: EnvMail = {
  host: 'mailpit',
  port: 1025,
  secure: 'none',
  username: null,
  password: ENV_SECRET,
  from: 'env@areca.local',
  replyTo: null,
}

const keys = {
  encryptionReady: true,
  encryptionKeyEnv: 'SECRETS_ENCRYPTION_KEY',
}

describe('mailSettingsStatus', () => {
  it('never includes a password, only whether one is set', () => {
    const status = mailSettingsStatus({ row, envMail, ...keys })
    const json = JSON.stringify(status)

    expect(json).not.toContain(SECRET)
    expect(json).not.toContain(ENV_SECRET)
    expect(json).not.toContain('encryptedPassword')
    expect(status.settings?.passwordSet).toBe(true)
    expect(status.env?.passwordSet).toBe(true)
  })

  it('reports settings as the source when enabled', () => {
    expect(mailSettingsStatus({ row, envMail, ...keys }).source).toBe(
      'settings',
    )
  })

  it('reports the environment when settings are switched off', () => {
    const status = mailSettingsStatus({
      row: { ...row, enabled: false },
      envMail,
      ...keys,
    })
    expect(status.source).toBe('env')
    expect(status.env).toMatchObject({ host: 'mailpit', passwordSet: true })
  })

  it('reports none when nothing is configured', () => {
    const status = mailSettingsStatus({
      row: null,
      envMail: null,
      encryptionReady: false,
      encryptionKeyEnv: 'SECRETS_ENCRYPTION_KEY',
    })
    expect(status).toMatchObject({ source: 'none', settings: null, env: null })
  })

  it('reports passwordSet false when no password is stored', () => {
    const status = mailSettingsStatus({
      row: { ...row, encryptedPassword: null },
      envMail: null,
      ...keys,
    })
    expect(status.settings?.passwordSet).toBe(false)
  })
})

describe('draftPassword', () => {
  const draft = {
    host: 'smtp.example.com',
    port: 587,
    username: 'cms',
    password: undefined,
    clearPassword: false,
  }
  // Stands in for decryption: returns the plain value of the stored token.
  const readStored = (encrypted: string | null) => (encrypted ? SECRET : null)

  it('reuses the stored password for the same host, port and username', () => {
    expect(draftPassword(draft, row, readStored)).toBe(SECRET)
  })

  it('never sends the stored password to another host, port or username', () => {
    expect(
      draftPassword(
        { ...draft, host: 'attacker.example.net' },
        row,
        readStored,
      ),
    ).toBeNull()
    expect(draftPassword({ ...draft, port: 25 }, row, readStored)).toBeNull()
    expect(
      draftPassword({ ...draft, username: 'someone-else' }, row, readStored),
    ).toBeNull()
    expect(
      draftPassword({ ...draft, username: '' }, row, readStored),
    ).toBeNull()
  })

  it('treats the host as the same after trimming', () => {
    expect(
      draftPassword({ ...draft, host: ' smtp.example.com ' }, row, readStored),
    ).toBe(SECRET)
  })

  it('uses a typed password over the stored one, even for another server', () => {
    expect(
      draftPassword(
        { ...draft, host: 'other.example.com', password: 'typed' },
        row,
        readStored,
      ),
    ).toBe('typed')
  })

  it('returns null when clearPassword is set', () => {
    expect(
      draftPassword({ ...draft, clearPassword: true }, row, readStored),
    ).toBeNull()
  })

  it('returns null without a stored row or stored password', () => {
    expect(draftPassword(draft, null, readStored)).toBeNull()
    expect(
      draftPassword(draft, { ...row, encryptedPassword: null }, readStored),
    ).toBeNull()
  })
})
