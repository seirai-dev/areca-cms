import { describe, expect, it } from 'vitest'

import { withSecurityHeaders } from './security-headers'

const NONCE = 'AbC_dEf-123456789012'

const production = { nonce: NONCE, reportOnly: false, development: false }

describe('withSecurityHeaders', () => {
  it('adds browser security headers without replacing route headers', () => {
    const response = withSecurityHeaders(
      new Request('https://cms.example.test'),
      new Response('ok', {
        headers: {
          'Cache-Control': 'public, max-age=60',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      }),
      production,
    )

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    )
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()')
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    )
    expect(response.headers.get('Strict-Transport-Security')).toContain(
      'max-age=31536000',
    )
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe(
      'cross-origin',
    )
  })

  it('enforces the nonce policy by default', () => {
    const response = withSecurityHeaders(
      new Request('https://cms.example.test'),
      new Response('ok'),
      production,
    )
    expect(response.headers.get('Content-Security-Policy')).toContain(
      `script-src 'self' 'nonce-${NONCE}'`,
    )
    expect(response.headers.has('Content-Security-Policy-Report-Only')).toBe(
      false,
    )
  })

  it('sends the same policy as Report-Only when the operator asks for it', () => {
    const response = withSecurityHeaders(
      new Request('https://cms.example.test'),
      new Response('ok'),
      { ...production, reportOnly: true },
    )
    expect(response.headers.has('Content-Security-Policy')).toBe(false)
    expect(
      response.headers.get('Content-Security-Policy-Report-Only'),
    ).toContain(`script-src 'self' 'nonce-${NONCE}'`)
  })

  it('does not advertise HSTS over local HTTP', () => {
    const response = withSecurityHeaders(
      new Request('http://localhost:3000'),
      new Response('ok'),
      production,
    )
    expect(response.headers.has('Strict-Transport-Security')).toBe(false)
  })
})
