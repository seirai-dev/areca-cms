import { describe, expect, it } from 'vitest'

import { ForbiddenError } from '#/server/content/errors'

import { credentialPhrase, goLiveDeniedMessage, requireAccess } from './guard'
import type { McpActor } from './keys'

function actor(overrides: Partial<McpActor> = {}): McpActor {
  return {
    keyId: 'k1',
    keyName: 'Test',
    credential: 'key',
    userId: 'u1',
    userName: 'Owner',
    siteId: 's1',
    siteSlug: 'site',
    siteName: 'Site',
    organizationId: 'o1',
    role: 'owner',
    allowGoLive: false,
    ...overrides,
  }
}

describe('credential wording', () => {
  it('calls a personal key a key and an OAuth connection an AI connection', () => {
    expect(credentialPhrase('key')).toBe('this key')
    expect(credentialPhrase('oauth')).toBe('this AI connection')
  })

  it('tells an OAuth caller how to fix a refused go-live, without mentioning keys', () => {
    const message = goLiveDeniedMessage('oauth')
    expect(message).toContain('Reconnect it from Connect AI')
    expect(message).toContain('"Allow going live"')
    expect(message).not.toMatch(/\bkey\b/)
  })

  it('keeps the key wording for keys', () => {
    expect(goLiveDeniedMessage('key')).toContain(
      'Going live is not enabled for this key',
    )
  })
})

describe('requireAccess', () => {
  it('uses the credential-specific go-live message when no message is given', () => {
    expect(() =>
      requireAccess(actor({ credential: 'oauth' }), 'go-live'),
    ).toThrow(ForbiddenError)
    expect(() =>
      requireAccess(actor({ credential: 'oauth' }), 'go-live'),
    ).toThrow(/Reconnect it from Connect AI/)
    expect(() =>
      requireAccess(actor({ credential: 'key' }), 'go-live'),
    ).toThrow(/Going live is not enabled for this key/)
  })

  it('lets a go-live actor through', () => {
    expect(() =>
      requireAccess(
        actor({ credential: 'oauth', allowGoLive: true }),
        'go-live',
      ),
    ).not.toThrow()
  })
})
