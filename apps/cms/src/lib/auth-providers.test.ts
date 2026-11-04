import { afterEach, describe, expect, it, vi } from 'vitest'

async function providersWith(env: Record<string, string | undefined>) {
  vi.resetModules()
  vi.doMock('#/env', () => ({
    env: {
      AUTH_EMAIL_PASSWORD_ENABLED: true,
      MICROSOFT_SSO_CLIENT_ID: 'client',
      MICROSOFT_SSO_CLIENT_SECRET: 'secret',
      MICROSOFT_SSO_TENANT_ID: 'tenant',
      ...env,
    },
  }))
  return import('./auth-providers')
}

const callback = '/sso/callback/microsoft'

describe('microsoftSsoVouchesFor', () => {
  afterEach(() => {
    vi.doUnmock('#/env')
  })

  it('vouches for addresses on the configured domain from the SSO callback', async () => {
    const providers = await providersWith({
      MICROSOFT_SSO_DOMAIN: '@Agency.Example',
    })
    expect(providers.microsoftSsoTrustsDomain).toBe(true)
    expect(providers.microsoftSso?.domain).toBe('agency.example')
    expect(
      providers.microsoftSsoVouchesFor(callback, 'Ann@AGENCY.example'),
    ).toBe(true)
  })

  it('does not vouch for other domains, subdomains or other endpoints', async () => {
    const { microsoftSsoVouchesFor } = await providersWith({
      MICROSOFT_SSO_DOMAIN: 'agency.example',
    })
    expect(microsoftSsoVouchesFor(callback, 'ann@other.example')).toBe(false)
    expect(microsoftSsoVouchesFor(callback, 'ann@evil.agency.example')).toBe(
      false,
    )
    expect(
      microsoftSsoVouchesFor('/callback/github', 'ann@agency.example'),
    ).toBe(false)
    expect(microsoftSsoVouchesFor(undefined, 'ann@agency.example')).toBe(false)
  })

  it('trusts nothing without a domain or without Microsoft SSO', async () => {
    const noDomain = await providersWith({ MICROSOFT_SSO_DOMAIN: undefined })
    expect(noDomain.microsoftSsoTrustsDomain).toBe(false)
    expect(
      noDomain.microsoftSsoVouchesFor(callback, 'ann@agency.example'),
    ).toBe(false)

    const noSso = await providersWith({
      MICROSOFT_SSO_DOMAIN: 'agency.example',
      MICROSOFT_SSO_CLIENT_SECRET: undefined,
    })
    expect(noSso.microsoftSsoTrustsDomain).toBe(false)
    expect(noSso.microsoftSsoVouchesFor(callback, 'ann@agency.example')).toBe(
      false,
    )
  })
})
