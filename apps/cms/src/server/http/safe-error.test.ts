import { notFound, redirect } from '@tanstack/react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { AssetInUseError, AssetValidationError } from '#/server/assets'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '#/server/content/errors'
import { setLogSink } from '#/server/log'

import { AppError } from './app-error'
import { UnsafeOutboundUrlError } from './outbound-url'
import { UploadTooLargeError } from './upload'
import { isPassthroughError, sanitizeServerError } from './safe-error'

describe('isPassthroughError', () => {
  it('passes the typed application errors', () => {
    expect(isPassthroughError(new NotFoundError())).toBe(true)
    expect(isPassthroughError(new ConflictError('x'))).toBe(true)
    expect(
      isPassthroughError(new ValidationError([{ path: 'a', message: 'b' }])),
    ).toBe(true)
    expect(isPassthroughError(new AssetValidationError('x'))).toBe(true)
    expect(isPassthroughError(new AssetInUseError(2))).toBe(true)
    expect(isPassthroughError(new UnsafeOutboundUrlError('x'))).toBe(true)
    expect(isPassthroughError(new UploadTooLargeError())).toBe(true)
    expect(
      isPassthroughError(new (class Custom extends AppError {})('x')),
    ).toBe(true)
  })

  it('passes errors carrying an allow-listed code (MFA/reauth)', () => {
    for (const code of ['MFA_REQUIRED', 'REAUTH_REQUIRED']) {
      expect(isPassthroughError(Object.assign(new Error('x'), { code }))).toBe(
        true,
      )
    }
    expect(
      isPassthroughError(Object.assign(new Error('x'), { expose: true })),
    ).toBe(true)
  })

  it('passes control-flow values', () => {
    expect(isPassthroughError(new Response('Forbidden', { status: 403 }))).toBe(
      true,
    )
    expect(isPassthroughError(redirect({ href: '/login' }))).toBe(true)
    expect(isPassthroughError(notFound())).toBe(true)
  })

  it('passes better-auth 4xx APIError only', () => {
    const api = (statusCode: number) =>
      Object.assign(new Error('x'), { name: 'APIError', statusCode })
    expect(isPassthroughError(api(403))).toBe(true)
    expect(isPassthroughError(api(500))).toBe(false)
  })

  it('does not pass internal errors', () => {
    expect(isPassthroughError(new Error('connect ECONNREFUSED'))).toBe(false)
    expect(
      isPassthroughError(
        Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe(false)
    expect(
      isPassthroughError(Object.assign(new Error('x'), { code: '23505' })),
    ).toBe(false)
    expect(isPassthroughError('string')).toBe(false)
    expect(isPassthroughError(null)).toBe(false)
  })
})

describe('sanitizeServerError', () => {
  let restore = () => {}
  afterEach(() => {
    restore()
    process.env.LOG_LEVEL = 'silent'
  })

  it('returns known errors unchanged', () => {
    const e = new ConflictError('slug exists')
    expect(sanitizeServerError(e)).toBe(e)
  })

  it('replaces unknown errors with a ref and logs the redacted original', () => {
    process.env.LOG_LEVEL = 'info'
    const lines: string[] = []
    restore = setLogSink((_l, line) => lines.push(line))
    const original = new Error(
      'connect failed postgres://u:topsecret1@db:5432/x password=hunter22',
    )
    const out = sanitizeServerError(original) as Error
    expect(out).not.toBe(original)
    const ref = /\(ref: ([a-f0-9]+)\)/.exec(out.message)?.[1]
    expect(ref).toBeTruthy()
    expect(out.message).toBe(`Something went wrong (ref: ${ref})`)
    expect(out.message).not.toMatch(/postgres|topsecret1/)
    expect(lines).toHaveLength(1)
    const logged = JSON.parse(lines[0])
    expect(logged.ref).toBe(ref)
    expect(logged.err.message).toContain('connect failed')
    expect(lines[0]).not.toMatch(/topsecret1|hunter22/)
  })
})
