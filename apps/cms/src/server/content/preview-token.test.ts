import { describe, expect, it } from 'vitest'

// Assumed API (preview-token.ts): signPreviewToken also accepts { siteId, global, secret }
// for a site content section (payload gains optional `global`), and
// buildGlobalPreviewUrl(productionUrl, previewPath, token) builds
// `<site><previewPath>?arecaPreview=<token>`.
import {
  buildGlobalPreviewUrl,
  buildPreviewUrl,
  signPreviewToken,
  verifyPreviewToken,
} from './preview-token.ts'

const secret = 'preview-secret'

describe('global preview token', () => {
  it('signs and verifies a token for a site content section', () => {
    const token = signPreviewToken({
      siteId: 'site_1',
      global: 'companyInfo',
      secret,
    })
    expect(verifyPreviewToken(token, secret)).toMatchObject({
      siteId: 'site_1',
      global: 'companyInfo',
    })
  })

  it('rejects an expired section token', () => {
    const token = signPreviewToken({
      siteId: 'site_1',
      global: 'companyInfo',
      secret,
      ttlSec: -5,
    })
    expect(verifyPreviewToken(token, secret)).toBeNull()
  })

  it('builds the section preview URL on the preview path, with the token as a query', () => {
    expect(
      buildGlobalPreviewUrl('http://localhost:3001/', '/about', 'tok'),
    ).toBe('http://localhost:3001/about?arecaPreview=tok')
    expect(buildGlobalPreviewUrl('http://localhost:3001', '/', 'tok')).toBe(
      'http://localhost:3001/?arecaPreview=tok',
    )
  })
})

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

describe('preview locale', () => {
  it('carries an optional locale in the token payload', () => {
    const token = signPreviewToken({
      siteId: 'site_1',
      collection: 'articles',
      slug: 'hello',
      locale: 'en',
      secret,
    })
    expect(verifyPreviewToken(token, secret)).toMatchObject({ locale: 'en' })
  })

  it('leaves the locale out of a token that has none', () => {
    const token = signPreviewToken({
      siteId: 'site_1',
      collection: 'articles',
      slug: 'hello',
      secret,
    })
    expect(verifyPreviewToken(token, secret)).not.toHaveProperty('locale')
  })

  it('appends &locale to entry and section preview URLs when given', () => {
    expect(
      buildPreviewUrl('http://localhost:3001', 'articles', 'hello', 'tok', 'en'),
    ).toBe('http://localhost:3001/__preview/articles/hello?token=tok&locale=en')
    expect(
      buildPreviewUrl('http://localhost:3001', 'articles', 'hello', 'tok'),
    ).toBe('http://localhost:3001/__preview/articles/hello?token=tok')
    expect(
      buildGlobalPreviewUrl('http://localhost:3001', '/about', 'tok', 'nl-BE'),
    ).toBe('http://localhost:3001/about?arecaPreview=tok&locale=nl-BE')
  })
})

