import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { env } from '#/env'

import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const target = {
  userId: 'user-1',
  organizationId: 'org-1',
  event: 'release.live' as const,
}

function withPayload(token: string, data: Record<string, unknown>) {
  const [, signature = ''] = token.split('.')
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${payload}.${signature}`
}

describe('unsubscribe tokens', () => {
  it('round-trips the user, organization and event', () => {
    const token = signUnsubscribeToken(target)
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: true, ...target })
  })

  it('round-trips agency-role tokens without an organization', () => {
    const token = signUnsubscribeToken({
      ...target,
      organizationId: null,
      event: 'agency.release.failed',
    })
    expect(verifyUnsubscribeToken(token)).toEqual({
      ok: true,
      userId: 'user-1',
      organizationId: null,
      event: 'agency.release.failed',
    })
  })

  it('accepts a token up to 60 days old and rejects it after', () => {
    const issued = new Date('2026-10-01T10:00:00Z')
    const token = signUnsubscribeToken(target, issued)
    expect(
      verifyUnsubscribeToken(token, new Date(issued.getTime() + 59 * DAY_MS)),
    ).toMatchObject({ ok: true })
    expect(
      verifyUnsubscribeToken(token, new Date(issued.getTime() + 61 * DAY_MS)),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a payload that was changed after signing', () => {
    const token = signUnsubscribeToken(target)
    const [, signature = ''] = token.split('.')
    const forged = withPayload(token, {
      u: 'someone-else',
      o: 'org-1',
      e: 'release.live',
      x: Math.floor(Date.now() / 1000) + 600,
    })
    expect(verifyUnsubscribeToken(forged)).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(forged.endsWith(signature)).toBe(true)
  })

  it('rejects a changed signature', () => {
    const token = signUnsubscribeToken(target)
    const [payload = ''] = token.split('.')
    expect(verifyUnsubscribeToken(`${payload}.${'A'.repeat(43)}`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('rejects malformed tokens', () => {
    for (const token of ['', 'no-dot-here', 'a.b.c', '.', 'x.y']) {
      expect(verifyUnsubscribeToken(token), token).toEqual({
        ok: false,
        reason: 'invalid',
      })
    }
  })

  it('rejects a token signed without the unsubscribe purpose prefix', () => {
    const payload = Buffer.from(
      JSON.stringify({
        u: 'user-1',
        o: 'org-1',
        e: 'release.live',
        x: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString('base64url')
    const signature = createHmac('sha256', env.BETTER_AUTH_SECRET)
      .update(payload)
      .digest('base64url')
    expect(verifyUnsubscribeToken(`${payload}.${signature}`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})
