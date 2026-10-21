import { afterEach, describe, expect, it } from 'vitest'

import { createLogger, setLogSink } from '#/server/log'
import type { LogLevel } from '#/server/log'

import {
  MailConfigError,
  logMailFailure,
  mailFailureMessage,
  toMailFailure,
} from './errors.ts'

function smtpError(
  props: Record<string, unknown>,
  message = 'SMTP failure',
): Error {
  return Object.assign(new Error(message), props)
}

const host = 'smtp.example.com'

describe('toMailFailure', () => {
  it('maps EAUTH and 535 to auth_failed (not retryable)', () => {
    const byCode = toMailFailure(smtpError({ code: 'EAUTH' }), { host })
    const byResponse = toMailFailure(
      smtpError({ responseCode: 535, command: 'AUTH PLAIN' }),
    )
    for (const failure of [byCode, byResponse]) {
      expect(failure.code).toBe('auth_failed')
      expect(failure.params).toEqual({})
      expect(failure.retryable).toBe(false)
    }
  })

  it('maps a refused STARTTLS to starttls_unsupported', () => {
    const refused = toMailFailure(
      smtpError({ code: 'ETLS', command: 'STARTTLS', responseCode: 502 }),
      { host },
    )
    expect(refused).toMatchObject({
      code: 'starttls_unsupported',
      params: { host },
      retryable: false,
    })

    const required = toMailFailure(
      smtpError(
        {
          code: 'ECONNECTION',
          command: 'EHLO',
          response: '500 unsupported',
        },
        'EHLO failed but HELO does not support required STARTTLS. response=500',
      ),
      { host },
    )
    expect(required.code).toBe('starttls_unsupported')
  })

  it.each([
    ['CERT_HAS_EXPIRED', 'CERT_HAS_EXPIRED'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_ALTNAME_INVALID'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'DEPTH_ZERO_SELF_SIGNED_CERT'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'SELF_SIGNED_CERT_IN_CHAIN'],
  ])('maps certificate error %s to tls_failed', (code, reason) => {
    const failure = toMailFailure(smtpError({ code }, 'certificate problem'), {
      host,
    })
    expect(failure).toMatchObject({
      code: 'tls_failed',
      params: { host, reason },
      retryable: false,
    })
  })

  it('maps a wrong-version handshake (TLS on a plain port) to tls_failed', () => {
    const failure = toMailFailure(
      smtpError(
        { code: 'ESOCKET' },
        'error:0A00010B:SSL routines:ssl3_get_record:wrong version number',
      ),
      { host, port: 587 },
    )
    expect(failure.code).toBe('tls_failed')
    expect(failure.params.host).toBe(host)
    expect(failure.params.reason).toContain('wrong version number')
  })

  it('maps MAIL FROM and RCPT TO rejections, with the reply and redaction', () => {
    const sender = toMailFailure(
      smtpError({ responseCode: 553, command: 'MAIL FROM' }),
      { from: 'cms@example.com' },
    )
    expect(sender).toMatchObject({
      code: 'sender_rejected',
      params: { from: 'cms@example.com' },
      retryable: false,
    })

    const recipient = toMailFailure(
      smtpError({
        responseCode: 550,
        command: 'RCPT TO',
        response: '550 5.1.1 user unknown for hunter2-secret',
      }),
      { to: 'ada@example.com', secrets: ['hunter2-secret'] },
    )
    expect(recipient.code).toBe('recipient_rejected')
    expect(recipient.params.to).toBe('ada@example.com')
    expect(recipient.params.reply).toBe('550 5.1.1 user unknown for [redacted]')
    expect(recipient.retryable).toBe(false)
    expect(JSON.stringify(recipient)).not.toContain('hunter2-secret')
  })

  it('maps timeouts to timeout (retryable)', () => {
    const failure = toMailFailure(
      smtpError({ code: 'ETIMEDOUT' }, 'Greeting never received'),
      { host },
    )
    expect(failure).toMatchObject({
      code: 'timeout',
      params: { host },
      retryable: true,
    })
  })

  it('maps rate limit codes and wording to rate_limited (retryable)', () => {
    const byCode = toMailFailure(
      smtpError({ responseCode: 451, command: 'DATA' }, 'Try later'),
    )
    const byText = toMailFailure(
      smtpError({ responseCode: 554 }, 'Too many messages sent'),
    )
    expect(byCode.code).toBe('rate_limited')
    expect(byText.code).toBe('rate_limited')
    expect(byCode.retryable).toBe(true)
  })

  it.each([
    ['ECONNREFUSED', undefined],
    ['ENOTFOUND', undefined],
    ['EDNS', undefined],
    ['ECONNECTION', undefined],
  ])('maps %s to connection_failed with host and port', (code) => {
    const failure = toMailFailure(smtpError({ code }, 'nope'), {
      host,
      port: 587,
    })
    expect(failure).toMatchObject({
      code: 'connection_failed',
      params: { host, port: '587' },
      retryable: true,
    })
  })

  it('falls back to unknown with the reply and outbox reference', () => {
    const failure = toMailFailure(
      smtpError({ code: 'EMESSAGE', response: '554 policy rejection' }),
      { outboxId: 'outbox-42' },
    )
    expect(failure).toMatchObject({
      code: 'unknown',
      params: { reply: '554 policy rejection', id: 'outbox-42' },
      retryable: true,
      ref: 'outbox-42',
    })
  })

  it('generates a reference for unknown errors when no outbox id is given', () => {
    const failure = toMailFailure(new Error('weird'))
    expect(failure.code).toBe('unknown')
    expect(failure.ref).toMatch(/^[0-9a-f]{10}$/)
    expect(failure.params.id).toBe(failure.ref)
  })

  it('maps configuration errors without retrying', () => {
    for (const code of [
      'not_configured',
      'password_unreadable',
      'insecure_public_host',
    ] as const) {
      const failure = toMailFailure(
        new MailConfigError(
          code,
          code === 'insecure_public_host' ? { host } : {},
        ),
      )
      expect(failure.code).toBe(code)
      expect(failure.retryable).toBe(false)
    }
    expect(
      toMailFailure(new MailConfigError('insecure_public_host', { host }))
        .params,
    ).toEqual({ host })
  })

  it('redacts secrets from detail and caps the lengths', () => {
    const password = 'correct-horse-battery'
    const failure = toMailFailure(
      smtpError({
        code: 'EMESSAGE',
        response: `554 ${'x'.repeat(300)} ${password}`,
      }),
      { secrets: [password] },
    )
    expect(JSON.stringify(failure)).not.toContain(password)
    expect(failure.params.reply.length).toBeLessThanOrEqual(200)
    expect(failure.detail.length).toBeLessThanOrEqual(500)
  })

  it('never retries auth, TLS, rejection or configuration failures', () => {
    const retryable = new Set([
      'connection_failed',
      'timeout',
      'rate_limited',
      'unknown',
    ])
    const samples = [
      toMailFailure(smtpError({ code: 'EAUTH' })),
      toMailFailure(smtpError({ code: 'CERT_HAS_EXPIRED' })),
      toMailFailure(smtpError({ responseCode: 550, command: 'RCPT TO' })),
      toMailFailure(new MailConfigError('not_configured')),
    ]
    for (const failure of samples) {
      expect(failure.retryable).toBe(retryable.has(failure.code))
    }
  })
})

describe('mailFailureMessage', () => {
  it('fills the placeholders for every code', () => {
    const cases = [
      { code: 'not_configured', params: {} },
      { code: 'auth_failed', params: {} },
      { code: 'connection_failed', params: { host, port: '587' } },
      { code: 'timeout', params: { host } },
      { code: 'tls_failed', params: { host, reason: 'CERT_HAS_EXPIRED' } },
      { code: 'starttls_unsupported', params: { host } },
      { code: 'sender_rejected', params: { from: 'cms@example.com' } },
      {
        code: 'recipient_rejected',
        params: { to: 'ada@example.com', reply: 'nope' },
      },
      { code: 'rate_limited', params: {} },
      { code: 'insecure_public_host', params: { host } },
      { code: 'password_unreadable', params: {} },
      { code: 'unknown', params: { reply: 'nope', id: 'abc' } },
    ] as const
    for (const failure of cases) {
      const message = mailFailureMessage(failure)
      expect(message.length).toBeGreaterThan(10)
      expect(message).not.toMatch(/\{[a-z]+\}/)
    }
    expect(
      mailFailureMessage({
        code: 'connection_failed',
        params: { host, port: '587' },
      }),
    ).toContain(host)
  })
})

describe('logMailFailure', () => {
  const restores: Array<() => void> = []
  const previousLevel = process.env.LOG_LEVEL

  afterEach(() => {
    while (restores.length) restores.pop()?.()
    process.env.LOG_LEVEL = previousLevel
  })

  function capture() {
    const lines: Array<{ level: LogLevel; entry: Record<string, unknown> }> = []
    restores.push(
      setLogSink((level, line) => {
        lines.push({ level, entry: JSON.parse(line) })
      }),
    )
    process.env.LOG_LEVEL = 'debug'
    return lines
  }

  it('warns while a retry is still scheduled and errors once it gives up', () => {
    const lines = capture()
    const logger = createLogger('mail')
    const failure = toMailFailure(smtpError({ code: 'ETIMEDOUT' }), {
      host,
      outboxId: 'outbox-1',
    })

    logMailFailure(logger, failure, {
      host,
      port: 587,
      secure: 'starttls',
      attempt: 1,
    })
    logMailFailure(logger, failure, {
      host,
      port: 587,
      secure: 'starttls',
      attempt: 3,
    })

    expect(lines.map((line) => line.level)).toEqual(['warn', 'error'])
    expect(lines[0].entry).toMatchObject({
      component: 'mail',
      code: 'timeout',
      host,
      port: 587,
      secure: 'starttls',
      outboxId: 'outbox-1',
      attempt: 1,
    })
  })

  it('logs non-retryable failures as errors with redacted err', () => {
    const lines = capture()
    const password = 'swordfish-123'
    const error = smtpError({ code: 'EAUTH' }, `auth failed for ${password}`)
    const failure = toMailFailure(error, { secrets: [password] })

    logMailFailure(createLogger('mail'), failure, {
      host,
      attempt: 1,
      error,
      secrets: [password],
    })

    expect(lines).toHaveLength(1)
    expect(lines[0].level).toBe('error')
    expect(lines[0].entry.code).toBe('auth_failed')
    expect(JSON.stringify(lines[0].entry)).not.toContain(password)
  })
})
