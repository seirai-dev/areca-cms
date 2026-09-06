import { describe, expect, it } from 'vitest'

import {
  buildPreviewUrl,
  signPreviewToken,
  verifyPreviewToken,
} from './preview-token.ts'

const secret = 'preview-secret'

describe('preview token', () => {
  it('signs and verifies a token', () => {
    const token = signPreviewToken({
      siteId: 'site_1',
      collection: 'articles',
      slug: 'hello',
      secret,
    })
    const payload = verifyPreviewToken(token, secret)
    expect(payload).toMatchObject({
      siteId: 'site_1',
      collection: 'articles',
      slug: 'hello',
    })
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects an expired token', () => {
    const token = signPreviewToken({
      siteId: 'site_1',
      collection: 'articles',
      slug: 'hello',
      secret,
      ttlSec: -5,
    })
    expect(verifyPreviewToken(token, secret)).toBeNull()
  })

  it('rejects a tampered token', () => {
    const token = signPreviewToken({
      siteId: 'site_1',
      collection: 'articles',
      slug: 'hello',
      secret,
    })
    const [payloadB64, sig] = token.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        siteId: 'site_1',
        collection: 'articles',
        slug: 'other',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url')
    expect(verifyPreviewToken(`${tamperedPayload}.${sig}`, secret)).toBeNull()
    expect(verifyPreviewToken(`${payloadB64}.aaaa`, secret)).toBeNull()
    expect(verifyPreviewToken(token, 'wrong-secret')).toBeNull()
  })

  it('builds the site preview URL', () => {
    expect(
      buildPreviewUrl('http://localhost:3001/', 'articles', 'hello', 'tok'),
    ).toBe('http://localhost:3001/__preview/articles/hello?token=tok')
  })
})
