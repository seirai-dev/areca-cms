import { describe, expect, it } from 'vitest'

import {
  claudeCodeCommand,
  claudeCodeConnectCommand,
  claudeDesktopConfig,
  connectSetupPrompt,
  connectorJsonConfig,
  cursorConnectLink,
  cursorInstallLink,
  genericMcpConfig,
  mcpServerName,
  setupPrompt,
  vscodeConnectLink,
  vscodeInstallLink,
} from './mcp-install'

const input = {
  name: 'areca-acme-site',
  url: 'https://cms.example.com/api/mcp',
  key: 'areca_mcp_abc123XYZ',
}

describe('mcpServerName', () => {
  it('prefixes the slug and keeps only [a-z0-9-]', () => {
    expect(mcpServerName('acme-site')).toBe('areca-acme-site')
    expect(mcpServerName('Acme Site!')).toBe('areca-acme-site')
    expect(mcpServerName('  --Über_café--  ')).toBe('areca-ber-caf')
    expect(mcpServerName('a..b')).toBe('areca-a-b')
  })

  it('falls back when nothing usable is left', () => {
    expect(mcpServerName('!!!')).toBe('areca-site')
  })
})

describe('claudeCodeCommand', () => {
  it('builds an http transport command with the bearer header', () => {
    expect(claudeCodeCommand(input)).toBe(
      'claude mcp add --transport http areca-acme-site https://cms.example.com/api/mcp --header "Authorization: Bearer areca_mcp_abc123XYZ"',
    )
  })
})

describe('cursorInstallLink', () => {
  it('round-trips the config through URL and base64 decoding', () => {
    const link = cursorInstallLink(input)
    const url = new URL(link)
    expect(url.protocol).toBe('cursor:')
    expect(url.hostname).toBe('anysphere.cursor-deeplink')
    expect(url.pathname).toBe('/mcp/install')
    expect(url.searchParams.get('name')).toBe('areca-acme-site')
    const config = url.searchParams.get('config') ?? ''
    const decoded = JSON.parse(
      Buffer.from(config, 'base64').toString('utf8'),
    ) as unknown
    expect(decoded).toEqual({
      url: input.url,
      headers: { Authorization: `Bearer ${input.key}` },
    })
  })

  it('survives non-ASCII names', () => {
    const link = cursorInstallLink({ ...input, name: 'naïve ✓' })
    const url = new URL(link)
    expect(url.searchParams.get('name')).toBe('naïve ✓')
    const config = url.searchParams.get('config') ?? ''
    expect(
      JSON.parse(Buffer.from(config, 'base64').toString('utf8')),
    ).toMatchObject({ url: input.url })
  })
})

describe('vscodeInstallLink', () => {
  it('encodes the JSON payload for both VS Code channels', () => {
    const payload = {
      name: input.name,
      type: 'http',
      url: input.url,
      headers: { Authorization: `Bearer ${input.key}` },
    }
    const stable = vscodeInstallLink(input)
    expect(stable.startsWith('vscode:mcp/install?')).toBe(true)
    expect(
      JSON.parse(
        decodeURIComponent(stable.slice('vscode:mcp/install?'.length)),
      ),
    ).toEqual(payload)
    const insiders = vscodeInstallLink(input, { insiders: true })
    expect(insiders.startsWith('vscode-insiders:mcp/install?')).toBe(true)
    expect(
      JSON.parse(
        decodeURIComponent(
          insiders.slice('vscode-insiders:mcp/install?'.length),
        ),
      ),
    ).toEqual(payload)
  })
})

describe('claudeDesktopConfig', () => {
  it('uses mcp-remote and keeps the key in an env var', () => {
    const config = JSON.parse(claudeDesktopConfig(input)) as {
      mcpServers: Record<
        string,
        { command: string; args: string[]; env: Record<string, string> }
      >
    }
    const server = config.mcpServers['areca-acme-site']
    expect(server).toBeDefined()
    expect(server.command).toBe('npx')
    expect(server.args).toEqual([
      '-y',
      'mcp-remote',
      input.url,
      '--header',
      'Authorization:${ARECA_AUTH}',
    ])
    expect(server.env).toEqual({ ARECA_AUTH: `Bearer ${input.key}` })
    expect(server.args.join(' ')).not.toContain(input.key)
  })
})

describe('genericMcpConfig', () => {
  it('lists an http server with the bearer header', () => {
    expect(JSON.parse(genericMcpConfig(input))).toEqual({
      mcpServers: {
        'areca-acme-site': {
          type: 'http',
          url: input.url,
          headers: { Authorization: `Bearer ${input.key}` },
        },
      },
    })
  })
})

describe('setupPrompt', () => {
  it('names the site, the endpoint, the header and the first tool to call', () => {
    const prompt = setupPrompt({
      siteName: 'Acme Site',
      url: input.url,
      key: input.key,
    })
    expect(prompt).toContain('"Acme Site"')
    expect(prompt).toContain(input.url)
    expect(prompt).toContain('Authorization: Bearer areca_mcp_abc123XYZ')
    expect(prompt).toContain('get_site_info')
  })
})

const connect = {
  name: 'areca-acme-site',
  url: 'https://cms.example.com/api/mcp/acme-site',
}

describe('connector builders (OAuth, no secret)', () => {
  it('builds the Claude Code command with the URL only', () => {
    expect(claudeCodeConnectCommand(connect)).toBe(
      'claude mcp add --transport http areca-acme-site https://cms.example.com/api/mcp/acme-site',
    )
    expect(claudeCodeConnectCommand(connect)).not.toContain('Authorization')
  })

  it('puts only the URL in the Cursor deeplink config', () => {
    const url = new URL(cursorConnectLink(connect))
    expect(url.protocol).toBe('cursor:')
    expect(url.searchParams.get('name')).toBe('areca-acme-site')
    const config = JSON.parse(
      Buffer.from(url.searchParams.get('config') ?? '', 'base64').toString(
        'utf8',
      ),
    ) as unknown
    expect(config).toEqual({ url: connect.url })
  })

  it('puts only type and URL in the VS Code payload, for both channels', () => {
    const stable = vscodeConnectLink(connect)
    expect(stable.startsWith('vscode:mcp/install?')).toBe(true)
    const payload = JSON.parse(
      decodeURIComponent(stable.slice('vscode:mcp/install?'.length)),
    ) as unknown
    expect(payload).toEqual({
      name: connect.name,
      type: 'http',
      url: connect.url,
    })
    expect(
      vscodeConnectLink(connect, { insiders: true }).startsWith(
        'vscode-insiders:mcp/install?',
      ),
    ).toBe(true)
  })

  it('writes a URL-only mcpServers JSON fallback', () => {
    expect(JSON.parse(connectorJsonConfig(connect)) as unknown).toEqual({
      mcpServers: { 'areca-acme-site': { url: connect.url } },
    })
  })

  it('writes a setup prompt that carries no key', () => {
    const prompt = connectSetupPrompt({
      siteName: 'Acme Website',
      url: connect.url,
    })
    expect(prompt).toContain(connect.url)
    expect(prompt).toContain('Acme Website')
    expect(prompt).not.toMatch(/areca_mcp_|Bearer/)
  })
})
