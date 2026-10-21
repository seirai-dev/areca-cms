import { describe, expect, it } from 'vitest'

import { MailConfigError } from './errors.ts'
import { createMailTransport, transportOptions } from './transport.ts'
import type { MailConfig } from './types.ts'

const base: MailConfig = {
  source: 'settings',
  host: 'smtp.example.com',
  port: 587,
  secure: 'starttls',
  username: null,
  password: null,
  from: 'cms@example.com',
  replyTo: null,
}

describe('transportOptions', () => {
  it('requires STARTTLS for starttls', () => {
    expect(transportOptions(base)).toMatchObject({
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
    })
  })

  it('uses implicit TLS for tls', () => {
    expect(
      transportOptions({ ...base, port: 465, secure: 'tls' }),
    ).toMatchObject({
      secure: true,
      requireTLS: false,
      ignoreTLS: false,
    })
  })

  it('skips TLS for none', () => {
    expect(
      transportOptions({
        ...base,
        host: 'mailpit',
        port: 1025,
        secure: 'none',
      }),
    ).toMatchObject({ secure: false, requireTLS: false, ignoreTLS: true })
  })

  it('always verifies certificates with TLS 1.2 or newer', () => {
    expect(transportOptions(base).tls).toEqual({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      servername: 'smtp.example.com',
    })
  })

  it('does not send SNI for IP literals', () => {
    expect(
      transportOptions({ ...base, host: '10.0.0.4' }).tls.servername,
    ).toBeUndefined()
  })

  it('uses 15 second connection, greeting and socket timeouts', () => {
    const options = transportOptions(base)
    expect(options.connectionTimeout).toBe(15_000)
    expect(options.greetingTimeout).toBe(15_000)
    expect(options.socketTimeout).toBe(15_000)
  })

  it('authenticates only when a username is set', () => {
    expect(transportOptions(base)).not.toHaveProperty('auth')
    expect(
      transportOptions({ ...base, username: 'cms', password: 'pw-123456' })
        .auth,
    ).toEqual({ user: 'cms', pass: 'pw-123456' })
  })
})

describe('createMailTransport', () => {
  it('refuses unencrypted SMTP to a public host before connecting', () => {
    expect(() => createMailTransport({ ...base, secure: 'none' })).toThrow(
      MailConfigError,
    )
  })

  it('creates a transport for a private host without TLS', () => {
    expect(() =>
      createMailTransport({
        ...base,
        host: 'mailpit',
        port: 1025,
        secure: 'none',
      }),
    ).not.toThrow()
  })
})
