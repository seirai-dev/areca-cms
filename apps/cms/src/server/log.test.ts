import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  collectSecretValues,
  createLogger,
  redactError,
  redactString,
  redactValue,
  setLogSink,
} from './log'

const env = {
  DATABASE_URL: 'postgres://areca:s3cretPassw0rd@db.internal:5432/areca',
  REDIS_URL: 'redis://:redisPass99@cache:6379',
  BETTER_AUTH_SECRET: 'auth-secret-value-123',
  S3_SECRET_KEY: 'minio-secret-key-456',
  DOKPLOY_API_KEY: 'dokploy-key-789',
  SMTP_PASSWORD: 'smtp-pass-000',
  METRICS_TOKEN: 'metrics-token-111',
  APP_URL: 'http://localhost:3000',
  S3_BUCKET: 'bucket',
}
const secrets = collectSecretValues(env)

describe('collectSecretValues', () => {
  it('collects env secrets and URL passwords, ignoring non-secrets', () => {
    expect(secrets).toEqual(
      expect.arrayContaining([
        's3cretPassw0rd',
        'redisPass99',
        'auth-secret-value-123',
        'minio-secret-key-456',
        'dokploy-key-789',
        'smtp-pass-000',
        'metrics-token-111',
      ]),
    )
    expect(secrets).not.toContain('bucket')
    expect(secrets).not.toContain('http://localhost:3000')
  })
})

describe('redactString', () => {
  it('removes known secret values anywhere in a string', () => {
    const out = redactString(
      'connect failed: s3cretPassw0rd then auth-secret-value-123',
      secrets,
    )
    expect(out).not.toContain('s3cretPassw0rd')
    expect(out).not.toContain('auth-secret-value-123')
  })

  it('strips URL userinfo', () => {
    expect(
      redactString('connect postgres://bob:hunter22@host:5432/db failed', []),
    ).toBe('connect postgres://[redacted]@host:5432/db failed')
    expect(redactString('https://user@example.com/x', [])).toBe(
      'https://[redacted]@example.com/x',
    )
  })

  it('redacts Authorization, Bearer and x-api-key', () => {
    expect(redactString('Authorization: Bearer abcdef123456', [])).not.toMatch(
      /abcdef123456/,
    )
    expect(
      redactString('header authorization=Basic dXNlcjpwYXNz', []),
    ).not.toMatch(/dXNlcjpwYXNz/)
    expect(redactString('got Bearer eyJhbGciOi.payload.sig here', [])).toBe(
      'got Bearer [redacted] here',
    )
    expect(redactString('x-api-key: abc123xyz789', [])).not.toMatch(
      /abc123xyz789/,
    )
    expect(redactString('{"X-Api-Key":"abc123xyz789"}', [])).not.toMatch(
      /abc123xyz789/,
    )
  })

  it('redacts sensitive key=value and JSON pairs', () => {
    expect(redactString('password=hunter2 user=bob', [])).toBe(
      'password=[redacted] user=bob',
    )
    expect(redactString('{"apiKey":"k-123456","name":"x"}', [])).toContain(
      '"name":"x"',
    )
    expect(redactString('{"apiKey":"k-123456"}', [])).not.toContain('k-123456')
    expect(redactString('GET /x?token=abcd1234&page=2', [])).toBe(
      'GET /x?token=[redacted]&page=2',
    )
  })

  it('redacts long token-looking values in generic key=value contexts', () => {
    const hex = 'a'.repeat(64)
    expect(redactString(`session=${hex}`, [])).toBe('session=[redacted]')
    const b64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='
    expect(redactString(`blob=${b64} ok`, [])).toBe('blob=[redacted] ok')
  })

  it('stays fast on huge adversarial inputs', () => {
    const inputs = [
      'y'.repeat(200_000),
      'token'.repeat(40_000),
      'a.b-'.repeat(50_000),
      'a'.repeat(100_000) + '=',
      'http'.repeat(50_000) + '://',
    ]
    const started = Date.now()
    for (const input of inputs) redactString(input, [])
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Publication worker lease lost for site abc (attempt 2)'
    expect(redactString(text, [])).toBe(text)
    expect(redactString('id=12345 status=failed', [])).toBe(
      'id=12345 status=failed',
    )
  })
})

describe('redactError / redactValue', () => {
  it('redacts message, stack and cause of errors', () => {
    const cause = new Error('inner postgres://u:pw12345@h/db')
    const error = new Error('outer s3cretPassw0rd', { cause })
    const out = redactError(error, secrets)
    expect(JSON.stringify(out)).not.toMatch(/s3cretPassw0rd|pw12345/)
    expect(out.name).toBe('Error')
    expect(out.cause).toBeTruthy()
  })

  it('handles non-Error values', () => {
    expect(redactError('Bearer abcdef123456', secrets).message).toBe(
      'Bearer [redacted]',
    )
    expect(redactError({ token: 'zzzzzzzz' }, secrets).message).not.toContain(
      'zzzzzzzz',
    )
  })

  it('keeps error code', () => {
    const e = Object.assign(new Error('x'), { code: 'ECONNREFUSED' })
    expect(redactError(e, secrets).code).toBe('ECONNREFUSED')
  })

  it('redacts sensitive keys and nested values and bounds depth', () => {
    const out = redactValue(
      { password: 'x1', nested: { a: { b: { c: { d: 1 } } } }, ok: 'fine' },
      secrets,
    ) as Record<string, unknown>
    expect(out.password).toBe('[redacted]')
    expect(out.ok).toBe('fine')
    expect(JSON.stringify(out)).toContain('[depth limit]')
  })
})

describe('createLogger', () => {
  let restore: () => void = () => {}
  beforeEach(() => {
    process.env.LOG_LEVEL = 'info'
  })
  afterEach(() => {
    restore()
    process.env.LOG_LEVEL = 'silent'
  })

  it('writes one redacted JSON line per call', () => {
    const lines: Array<[string, string]> = []
    restore = setLogSink((level, line) => lines.push([level, line]))
    process.env.BETTER_AUTH_SECRET = 'super-secret-value-9'
    const log = createLogger('worker')
    log.error('failed with super-secret-value-9', {
      err: new Error('db postgres://a:b1234567@h/x'),
      siteId: 's1',
      token: 'abc',
      msg: 'clash',
    })
    delete process.env.BETTER_AUTH_SECRET
    expect(lines).toHaveLength(1)
    const [level, raw] = lines[0]
    expect(level).toBe('error')
    const parsed = JSON.parse(raw)
    expect(parsed).toMatchObject({
      level: 'error',
      component: 'worker',
      siteId: 's1',
      token: '[redacted]',
      field_msg: 'clash',
    })
    expect(parsed.time).toMatch(/^\d{4}-/)
    expect(raw).not.toMatch(/super-secret-value-9|b1234567/)
    expect(parsed.err.name).toBe('Error')
  })

  it('respects LOG_LEVEL and child components', () => {
    const lines: string[] = []
    restore = setLogSink((_l, line) => lines.push(line))
    const log = createLogger('a').child('b')
    log.info('shown')
    process.env.LOG_LEVEL = 'warn'
    log.info('hidden')
    log.warn('warned')
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(['shown', 'warned'])
    expect(JSON.parse(lines[0]).component).toBe('a.b')
  })
})
