import { afterEach, describe, expect, it } from 'vitest'

import { ConflictError } from '#/server/content/errors'
import { setLogSink } from '#/server/log'

import { sanitizeErrorsMiddleware } from './error-middleware'

type ServerFn = (ctx: { next: () => Promise<unknown> }) => Promise<unknown>
const run = (next: () => Promise<unknown>) =>
  (sanitizeErrorsMiddleware.options.server as unknown as ServerFn)({ next })

describe('sanitizeErrorsMiddleware', () => {
  let restore = () => {}
  afterEach(() => restore())

  it('passes results through', async () => {
    expect(await run(async () => 'ok')).toBe('ok')
  })

  it('rethrows typed errors untouched', async () => {
    const e = new ConflictError('Slug already exists')
    await expect(run(() => Promise.reject(e))).rejects.toBe(e)
  })

  it('replaces unknown errors with a generic message', async () => {
    restore = setLogSink(() => {})
    await expect(
      run(() => Promise.reject(new Error('relation "user" does not exist'))),
    ).rejects.toThrow(/^Something went wrong \(ref: [a-f0-9]{10}\)$/)
  })
})
