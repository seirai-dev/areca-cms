import { describe, expect, it } from 'vitest'

import { env } from '#/env'

import { siteSlugFromMcpResource, mcpResourceUrl } from './oauth-resource'

const base = env.APP_URL.replace(/\/+$/, '')
const origin = new URL(base).origin

describe('MCP resource identifiers', () => {
  it('builds the connector URL the protected resource metadata names', () => {
    expect(mcpResourceUrl('acme-site')).toBe(`${base}/api/mcp/acme-site`)
  })

  it('accepts only the exact resource of this deployment', () => {
    expect(siteSlugFromMcpResource(`${base}/api/mcp/acme-site`)).toBe('acme-site')
    for (const bad of [
      `${base}/api/mcp/acme-site/`,
      `${base}/api/mcp/acme-site?x=1`,
      `${base}/api/mcp/Acme`,
      `${base}/api/mcp/`,
      `${base}/api/mcp/a/b`,
      'https://evil.example.com/api/mcp/acme-site',
      `${origin}.evil.test/api/mcp/acme-site`,
      `${origin}.evil.test:443/api/mcp/acme-site`,
      `${origin}/api/other/acme-site`,
    ]) {
      expect(siteSlugFromMcpResource(bad), bad).toBeNull()
    }
  })
})
