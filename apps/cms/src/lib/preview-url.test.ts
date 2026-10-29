import { describe, expect, it } from 'vitest'

import {
  normalizePreviewUrl,
  previewBaseUrl,
  previewOrigin,
} from './preview-url'

describe('previewBaseUrl', () => {
  it('falls back to the production URL when no preview URL is set', () => {
    expect(
      previewBaseUrl({ previewUrl: null, productionUrl: 'https://acme.test' }),
    ).toBe('https://acme.test')
    expect(previewBaseUrl({ productionUrl: 'https://acme.test' })).toBe(
      'https://acme.test',
    )
  })

  it('treats an empty preview URL as unset', () => {
    expect(
      previewBaseUrl({ previewUrl: '', productionUrl: 'https://acme.test' }),
    ).toBe('https://acme.test')
  })

  it('prefers the preview URL when set', () => {
    expect(
      previewBaseUrl({
        previewUrl: 'http://localhost:3000',
        productionUrl: 'https://acme.test',
      }),
    ).toBe('http://localhost:3000')
  })
})

describe('previewOrigin', () => {
  it('returns the origin of the preview base URL', () => {
    expect(
      previewOrigin({
        previewUrl: 'https://staging.acme.test',
        productionUrl: 'https://acme.test',
      }),
    ).toBe('https://staging.acme.test')
  })

  it('returns null when the base URL is not a valid URL', () => {
    expect(
      previewOrigin({ previewUrl: null, productionUrl: 'not a url' }),
    ).toBeNull()
  })
})

describe('normalizePreviewUrl', () => {
  it('returns null for empty or missing input (clears the setting)', () => {
    expect(normalizePreviewUrl(null)).toBeNull()
    expect(normalizePreviewUrl(undefined)).toBeNull()
    expect(normalizePreviewUrl('')).toBeNull()
    expect(normalizePreviewUrl('   ')).toBeNull()
  })

  it('trims and strips trailing slashes', () => {
    expect(normalizePreviewUrl('  https://staging.acme.test/  ')).toBe(
      'https://staging.acme.test',
    )
    expect(normalizePreviewUrl('http://localhost:3000///')).toBe(
      'http://localhost:3000',
    )
  })

  it('accepts http and https origins, with or without a port', () => {
    expect(normalizePreviewUrl('http://localhost:3000')).toBe(
      'http://localhost:3000',
    )
    expect(normalizePreviewUrl('https://staging.acme.test')).toBe(
      'https://staging.acme.test',
    )
  })

  it('rejects other schemes', () => {
    expect(() => normalizePreviewUrl('ftp://x')).toThrow()
    expect(() => normalizePreviewUrl('javascript:alert(1)')).toThrow()
  })

  it('rejects anything that is not a URL', () => {
    expect(() => normalizePreviewUrl('localhost:3000')).toThrow()
    expect(() => normalizePreviewUrl('staging acme')).toThrow()
  })

  it('rejects a path, a query or a hash', () => {
    expect(() => normalizePreviewUrl('https://x.com/path')).toThrow()
    expect(() => normalizePreviewUrl('https://x.com/?a=1')).toThrow()
    expect(() => normalizePreviewUrl('https://x.com/#top')).toThrow()
    expect(() => normalizePreviewUrl('https://x.com?a=1')).toThrow()
  })
})
