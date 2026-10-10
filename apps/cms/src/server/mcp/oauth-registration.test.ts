import { describe, expect, it } from 'vitest'

import { MCP_OAUTH_SCOPES } from './oauth-resource'
import {
  normaliseRegistrationBody,
  registrationApplicationType,
} from './oauth-registration'

describe('registrationApplicationType', () => {
  it.each([
    ['Claude Code', ['http://localhost:52811/callback']],
    ['Cursor', ['http://localhost:8787/callback']],
    ['VS Code loopback', ['http://127.0.0.1:33418/', 'http://127.0.0.1/']],
    ['Gemini CLI', ['http://localhost:45123/oauth/callback']],
    ['IPv6 loopback', ['http://[::1]:9000/cb']],
    ['VS Code mixed', ['https://vscode.dev/redirect', 'http://127.0.0.1:33418/']],
    ['Cursor mixed', ['https://www.cursor.com/agents/mcp/oauth/callback', 'http://localhost:8787/callback']],
  ])('registers %s as native', (_label, redirect_uris) => {
    expect(registrationApplicationType({ redirect_uris })).toBe('native')
  })

  it('leaves all-https registrations to the plugin web rules', () => {
    expect(
      registrationApplicationType({
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      }),
    ).toBeUndefined()
    expect(
      registrationApplicationType({
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      }),
    ).toBeUndefined()
  })

  it.each([
    ['non-loopback http', ['http://evil.example/cb']],
    ['LAN http', ['http://192.168.1.20:3000/cb']],
    ['loopback lookalike', ['http://localhost.evil.example/cb']],
    ['0.0.0.0', ['http://0.0.0.0:8000/cb']],
    ['custom scheme alongside loopback', ['cursor://anysphere.cursor-mcp/oauth/callback', 'http://localhost:8787/callback']],
    ['custom scheme only', ['com.example.app:/callback']],
    ['https loopback', ['https://localhost:8443/cb']],
    ['not a URL', ['localhost:8787/callback']],
    ['empty list', []],
    ['missing', undefined],
  ])('does not switch %s to native', (_label, redirect_uris) => {
    expect(registrationApplicationType({ redirect_uris })).toBeUndefined()
  })

  it('keeps an explicit application_type from the client', () => {
    expect(
      registrationApplicationType({
        application_type: 'web',
        redirect_uris: ['http://localhost:8787/callback'],
      }),
    ).toBeUndefined()
  })
})

describe('normaliseRegistrationBody', () => {
  it('sets native and the full MCP scope set for a loopback client', () => {
    const body = normaliseRegistrationBody({
      client_name: 'Claude Code (laptop)',
      redirect_uris: ['http://localhost:52811/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp',
    })
    expect(body).toMatchObject({
      client_name: 'Claude Code (laptop)',
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      scope: MCP_OAUTH_SCOPES.join(' '),
    })
  })

  it('leaves an https client untouched apart from the scope set', () => {
    const body = normaliseRegistrationBody({
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    })
    expect(body).not.toHaveProperty('application_type')
    expect(body.redirect_uris).toEqual([
      'https://chatgpt.com/connector_platform_oauth_redirect',
    ])
  })
})
