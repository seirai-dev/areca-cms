import { describe, expect, it } from 'vitest'

import { withSecurityHeaders } from './security-headers'

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

  it('observes a strict CSP without enforcing it yet', () => {
    const response = withSecurityHeaders(
      new Request('https://cms.example.test'),
      new Response('ok'),
    )
    // Enforced policy is unchanged.
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    )
    const reportOnly = response.headers.get(
      'Content-Security-Policy-Report-Only',
    )
    expect(reportOnly).toContain("default-src 'self'")
    expect(reportOnly).toContain("script-src 'self';")
    expect(reportOnly).not.toMatch(/script-src[^;]*unsafe-/)
    expect(reportOnly).toContain("style-src 'self' 'unsafe-inline'")
    expect(reportOnly).toContain("frame-ancestors 'none'")
    expect(reportOnly).toContain("form-action 'self'")
  })

  it('does not advertise HSTS over local HTTP', () => {
    const response = withSecurityHeaders(
      new Request('http://localhost:3000'),
      new Response('ok'),
    )
    expect(response.headers.has('Strict-Transport-Security')).toBe(false)
  })
})
