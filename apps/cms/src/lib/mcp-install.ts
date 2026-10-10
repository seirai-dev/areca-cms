/**
 * Pure builders for the "Connect AI" install snippets (one per AI app). The
 * UI shows them with the real key embedded, right after a key is created.
 * Nothing here touches the DOM or the server, so it is unit-tested directly.
 */

export type McpInstallInput = {
  /** Server name shown in the AI app, e.g. `areca-acme-site`. */
  name: string
  /** The per-site MCP endpoint, e.g. `https://cms.example.com/api/mcp`. */
  url: string
  /** The full key, `areca_mcp_…`. Only ever held in component state. */
  key: string
}

/** `areca-<site slug>` with only `[a-z0-9-]` characters. */
export function mcpServerName(siteSlug: string): string {
  const slug = siteSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `areca-${slug || 'site'}`
}

function bearer(key: string) {
  return `Bearer ${key}`
}

/** UTF-8 safe base64 that works in browsers and Node. */
function toBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/** `claude mcp add …`, ready to paste into a terminal. */
export function claudeCodeCommand({ name, url, key }: McpInstallInput): string {
  return `claude mcp add --transport http ${name} ${url} --header "Authorization: ${bearer(key)}"`
}

/** One-click install link for Cursor (`cursor://` deeplink). */
export function cursorInstallLink({ name, url, key }: McpInstallInput): string {
  const config = toBase64(
    JSON.stringify({ url, headers: { Authorization: bearer(key) } }),
  )
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`
}

/** One-click install link for VS Code (or VS Code Insiders). */
export function vscodeInstallLink(
  { name, url, key }: McpInstallInput,
  options: { insiders?: boolean } = {},
): string {
  const scheme = options.insiders ? 'vscode-insiders' : 'vscode'
  const payload = JSON.stringify({
    name,
    type: 'http',
    url,
    headers: { Authorization: bearer(key) },
  })
  return `${scheme}:mcp/install?${encodeURIComponent(payload)}`
}

/**
 * claude_desktop_config.json. Claude Desktop only speaks stdio, so the
 * remote server is reached through `mcp-remote`. The key goes in an env var
 * so the header value never appears in the args list.
 */
export function claudeDesktopConfig({
  name,
  url,
  key,
}: McpInstallInput): string {
  return JSON.stringify(
    {
      mcpServers: {
        [name]: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            url,
            '--header',
            'Authorization:${ARECA_AUTH}',
          ],
          env: { ARECA_AUTH: bearer(key) },
        },
      },
    },
    null,
    2,
  )
}

/** Generic `mcpServers` JSON for any app that reads remote HTTP servers. */
export function genericMcpConfig({ name, url, key }: McpInstallInput): string {
  return JSON.stringify(
    {
      mcpServers: {
        [name]: {
          type: 'http',
          url,
          headers: { Authorization: bearer(key) },
        },
      },
    },
    null,
    2,
  )
}

/**
 * A prompt any AI assistant can follow to connect itself. Written for the
 * model, so it stays in English whatever the UI language is.
 */
export function setupPrompt({
  siteName,
  url,
  key,
}: {
  siteName: string
  url: string
  key: string
}): string {
  return `Please connect to my Areca CMS site "${siteName}" as an MCP server. Server URL: ${url} (Streamable HTTP). Send the header Authorization: ${bearer(key)}. Once connected, call get_site_info to see what you can do.`
}

/**
 * The connector builders. They carry only the URL: AI apps sign in through
 * the browser (OAuth), so nothing secret is written into a config or command.
 */
export type McpConnectInput = {
  /** Server name shown in the AI app, e.g. `areca-acme-site`. */
  name: string
  /** The site's connector URL, e.g. `https://cms.example.com/api/mcp/acme-site`. */
  url: string
}

/** `claude mcp add …` for Claude Code. Claude Code then asks to sign in. */
export function claudeCodeConnectCommand({
  name,
  url,
}: McpConnectInput): string {
  return `claude mcp add --transport http ${name} ${url}`
}

/** One-click Cursor install (`cursor://` deeplink) with only the URL. */
export function cursorConnectLink({ name, url }: McpConnectInput): string {
  const config = toBase64(JSON.stringify({ url }))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`
}

/** One-click VS Code (or Insiders) install with only the URL. */
export function vscodeConnectLink(
  { name, url }: McpConnectInput,
  options: { insiders?: boolean } = {},
): string {
  const scheme = options.insiders ? 'vscode-insiders' : 'vscode'
  const payload = JSON.stringify({ name, type: 'http', url })
  return `${scheme}:mcp/install?${encodeURIComponent(payload)}`
}

/** `mcpServers` JSON with the URL only, for apps that read a settings file. */
export function connectorJsonConfig({ name, url }: McpConnectInput): string {
  return JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2)
}

/**
 * Installs the Areca agent skills and registers this connector URL (no
 * secret) in the coding agents the user picks.
 */
export function skillsInstallCommand(url: string): string {
  return `npx @areca-cms/skills --mcp-url ${url}`
}

/**
 * A prompt an AI assistant can follow to connect itself. No secret in it:
 * the assistant's app runs the browser sign-in. English, as with setupPrompt.
 */
export function connectSetupPrompt({
  siteName,
  url,
}: {
  siteName: string
  url: string
}): string {
  return `Please connect to my Areca CMS site "${siteName}" as an MCP server. Server URL: ${url} (Streamable HTTP). If the connection asks me to sign in, I will sign in with my Areca account and approve access. Once connected, call get_site_info to see what you can do.`
}
