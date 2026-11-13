import { describe, expect, it } from 'vitest'

import {
  assertSafeHealthCheckUrl,
  assertSecureServiceUrl,
  UnsafeOutboundUrlError,
} from './outbound-url'

describe('outbound URL validation', () => {
  it('requires HTTPS except for localhost or explicit local development', () => {
    expect(() => assertSecureServiceUrl('http://example.com')).toThrow(
      UnsafeOutboundUrlError,
    )
    expect(assertSecureServiceUrl('http://localhost:3000').hostname).toBe(
      'localhost',
    )
    expect(assertSecureServiceUrl('http://192.168.1.5', true).hostname).toBe(
      '192.168.1.5',
    )
    expect(assertSecureServiceUrl('http://[::1]:3000').hostname).toBe('[::1]')
  })

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '::1',
    'fe80::1',
    'fd00::1',
    'fec0::1',
    '100::1',
    '::7f00:1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::',
    '2002:a9fe:a9fe::1',
  ])('refuses a health check that resolves to %s', async (address) => {
    await expect(
      assertSafeHealthCheckUrl('https://example.test/health', {
        resolve: async () => [address],
      }),
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError)
  })

  it.each([
    'https://[::7f00:1]/health',
    'https://[::127.0.0.1]/health',
    'https://[64:ff9b::127.0.0.1]/health',
    'https://[2002:7f00:1::]/health',
    'https://[fec0::1]/health',
  ])('refuses the literal %s without a DNS lookup', async (url) => {
    await expect(
      assertSafeHealthCheckUrl(url, {
        resolve: async () => {
          throw new Error('unexpected lookup')
        },
      }),
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError)
  })

  it.each(['192.0.1.1', '192.0.3.1', '198.51.99.1', '203.0.114.1'])(
    'accepts the public address %s next to a documentation range',
    async (address) => {
      await expect(
        assertSafeHealthCheckUrl('https://example.test/health', {
          resolve: async () => [address],
        }),
      ).resolves.toHaveProperty('hostname', 'example.test')
    },
  )

  it('rejects a hostname if any DNS answer is private', async () => {
    await expect(
      assertSafeHealthCheckUrl('https://example.test/health', {
        resolve: async () => ['93.184.216.34', '127.0.0.1'],
      }),
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError)
  })

  it('accepts a public HTTPS target', async () => {
    const url = await assertSafeHealthCheckUrl('https://example.test/health', {
      resolve: async () => ['93.184.216.34'],
    })
    expect(url.href).toBe('https://example.test/health')
  })

  it('handles bracketed IPv6 literals without a DNS lookup', async () => {
    let resolved = false
    await expect(
      assertSafeHealthCheckUrl('https://[2606:4700:4700::1111]/health', {
        resolve: async () => {
          resolved = true
          return []
        },
      }),
    ).resolves.toHaveProperty('hostname', '[2606:4700:4700::1111]')
    expect(resolved).toBe(false)
  })
})
