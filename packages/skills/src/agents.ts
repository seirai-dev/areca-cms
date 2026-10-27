/**
 * Where each agent reads Agent Skills (SKILL.md folders) and how it registers a
 * remote MCP server. Project paths are relative to the repo; global paths are
 * relative to the home directory. Agents that share `.agents/skills` dedupe to
 * one copy on install.
 */

export type McpTarget =
  /** Merge `{ [key]: { [name]: entry } }` into a JSON file in the project. */
  | { kind: 'json'; file: string; key: string; entry: (url: string) => Record<string, unknown> }
  /** Append `[mcp_servers.<name>]` to a TOML file in the project. */
  | { kind: 'toml'; file: string }
  /** Write a standalone YAML file per server in the project. */
  | { kind: 'yaml'; dir: string }
  /** No project config: print where and what to add. */
  | { kind: 'manual'; where: string; snippet: (name: string, url: string) => string }

export type AgentGroup = 'popular' | 'more' | 'chat'

export type Agent = {
  id: string
  label: string
  group: AgentGroup
  /** Project skills dir. Absent for chat apps (zip upload only). */
  projectDir?: string
  /** User-level skills dir, relative to `~`. */
  globalDir?: string
  /** Paths whose presence suggests the agent is used in this project. */
  detect: string[]
  /** MCP registration. Multiple entries when an agent reads several files. */
  mcp: McpTarget[]
  /** Shown after install, e.g. how to sign in to the MCP server. */
  after?: string
}

const json = (file: string, key: string, entry: (url: string) => Record<string, unknown>): McpTarget => ({
  kind: 'json',
  file,
  key,
  entry,
})
const manual = (where: string, snippet: (name: string, url: string) => string): McpTarget => ({
  kind: 'manual',
  where,
  snippet,
})
const jsonSnippet = (key: string, entry: Record<string, unknown>) => (name: string) =>
  JSON.stringify({ [key]: { [name]: entry } }, null, 2)

const httpEntry = (url: string) => ({ type: 'http', url })
const urlEntry = (url: string) => ({ url })
const settingsUi = manual('the MCP settings screen', (name, url) => `Add a remote (Streamable HTTP) server named ${name} with URL ${url}`)

export const AGENTS: Agent[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    group: 'popular',
    projectDir: '.claude/skills',
    globalDir: '.claude/skills',
    detect: ['.claude', 'CLAUDE.md', '.mcp.json'],
    mcp: [json('.mcp.json', 'mcpServers', httpEntry)],
    after: 'Claude Code: run /mcp, pick the Areca server and choose Authenticate.',
  },
  {
    id: 'codex',
    label: 'Codex (CLI, IDE, app)',
    group: 'popular',
    projectDir: '.agents/skills',
    globalDir: '.agents/skills',
    detect: ['.codex', 'AGENTS.md'],
    mcp: [{ kind: 'toml', file: '.codex/config.toml' }],
    after: 'Codex: run `codex mcp login <name>` (project config needs a trusted project).',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    group: 'popular',
    projectDir: '.agents/skills',
    globalDir: '.cursor/skills',
    detect: ['.cursor', '.cursorrules'],
    mcp: [json('.cursor/mcp.json', 'mcpServers', urlEntry)],
    after: 'Cursor: enable the server in Settings > MCP and sign in when asked.',
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot (VS Code, CLI)',
    group: 'popular',
    projectDir: '.agents/skills',
    globalDir: '.copilot/skills',
    detect: ['.github/copilot-instructions.md', '.github/skills', '.vscode/mcp.json'],
    mcp: [json('.vscode/mcp.json', 'servers', httpEntry), json('.mcp.json', 'mcpServers', httpEntry)],
    after: 'VS Code: start the server from .vscode/mcp.json and sign in when asked.',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    group: 'popular',
    projectDir: '.agents/skills',
    globalDir: '.config/opencode/skills',
    detect: ['opencode.json', 'opencode.jsonc', '.opencode'],
    mcp: [json('opencode.json', 'mcp', (url) => ({ type: 'remote', url, enabled: true }))],
    after: 'OpenCode: run `opencode mcp auth <name>`.',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    group: 'popular',
    projectDir: '.agents/skills',
    globalDir: '.gemini/skills',
    detect: ['.gemini', 'GEMINI.md'],
    mcp: [json('.gemini/settings.json', 'mcpServers', (url) => ({ httpUrl: url }))],
    after: 'Gemini CLI: run `/mcp auth <name>`.',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    group: 'popular',
    projectDir: '.windsurf/skills',
    globalDir: '.codeium/windsurf/skills',
    detect: ['.windsurf', '.windsurfrules'],
    mcp: [
      manual('~/.codeium/windsurf/mcp_config.json', (name, url) =>
        jsonSnippet('mcpServers', { serverUrl: url })(name),
      ),
    ],
  },
  {
    id: 'antigravity',
    label: 'Antigravity (IDE, CLI)',
    group: 'more',
    projectDir: '.agents/skills',
    globalDir: '.gemini/antigravity/skills',
    detect: [],
    mcp: [settingsUi],
  },
  {
    id: 'cline',
    label: 'Cline',
    group: 'more',
    projectDir: '.cline/skills',
    globalDir: '.cline/skills',
    detect: ['.cline', '.clinerules'],
    mcp: [
      manual('Cline > MCP Servers > Configure (cline_mcp_settings.json)', (name, url) =>
        jsonSnippet('mcpServers', { type: 'streamableHttp', url })(name),
      ),
    ],
  },
  {
    id: 'roo',
    label: 'Roo Code',
    group: 'more',
    projectDir: '.roo/skills',
    globalDir: '.roo/skills',
    detect: ['.roo', '.roorules'],
    mcp: [json('.roo/mcp.json', 'mcpServers', (url) => ({ type: 'streamable-http', url }))],
  },
  {
    id: 'kilo',
    label: 'Kilo Code',
    group: 'more',
    projectDir: '.agents/skills',
    globalDir: '.kilo/skills',
    detect: ['.kilocode'],
    mcp: [settingsUi],
  },
  {
    id: 'kiro',
    label: 'Kiro',
    group: 'more',
    projectDir: '.kiro/skills',
    globalDir: '.kiro/skills',
    detect: ['.kiro'],
    mcp: [json('.kiro/settings/mcp.json', 'mcpServers', urlEntry)],
  },
  {
    id: 'amp',
    label: 'Amp',
    group: 'more',
    projectDir: '.agents/skills',
    globalDir: '.config/agents/skills',
    detect: ['.amp'],
    mcp: [
      manual('.amp/settings.json or your Amp user settings', (name, url) =>
        jsonSnippet('amp.mcpServers', { url })(name),
      ),
    ],
  },
  {
    id: 'factory',
    label: 'Factory Droid',
    group: 'more',
    projectDir: '.factory/skills',
    globalDir: '.factory/skills',
    detect: ['.factory'],
    mcp: [json('.factory/mcp.json', 'mcpServers', httpEntry)],
  },
  {
    id: 'goose',
    label: 'Goose',
    group: 'more',
    projectDir: '.agents/skills',
    globalDir: '.agents/skills',
    detect: ['.goosehints'],
    mcp: [
      manual(
        '~/.config/goose/config.yaml',
        (name, url) =>
          `extensions:\n  ${name}:\n    name: ${name}\n    type: streamable_http\n    uri: ${url}\n    enabled: true`,
      ),
    ],
  },
  {
    id: 'junie',
    label: 'JetBrains Junie',
    group: 'more',
    projectDir: '.junie/skills',
    globalDir: '.junie/skills',
    detect: ['.junie'],
    mcp: [json('.junie/mcp/mcp.json', 'mcpServers', urlEntry)],
  },
  {
    id: 'continue',
    label: 'Continue',
    group: 'more',
    projectDir: '.continue/skills',
    globalDir: '.continue/skills',
    detect: ['.continue'],
    mcp: [{ kind: 'yaml', dir: '.continue/mcpServers' }],
  },
  {
    id: 'augment',
    label: 'Augment (Auggie)',
    group: 'more',
    projectDir: '.augment/skills',
    globalDir: '.augment/skills',
    detect: ['.augment', '.augment-guidelines'],
    mcp: [manual('~/.augment/settings.json', (name, url) => jsonSnippet('mcpServers', httpEntry(url))(name))],
  },
  {
    id: 'zed',
    label: 'Zed',
    group: 'more',
    projectDir: '.agents/skills',
    globalDir: '.agents/skills',
    detect: ['.zed', '.rules'],
    mcp: [manual('~/.config/zed/settings.json', (name, url) => jsonSnippet('context_servers', { url })(name))],
  },
  {
    id: 'trae',
    label: 'Trae',
    group: 'more',
    projectDir: '.trae/skills',
    globalDir: '.trae/skills',
    detect: ['.trae'],
    mcp: [settingsUi],
  },
  {
    id: 'warp',
    label: 'Warp',
    group: 'more',
    projectDir: '.agents/skills',
    globalDir: '.agents/skills',
    detect: ['WARP.md'],
    mcp: [settingsUi],
  },
  {
    id: 'openhands',
    label: 'OpenHands',
    group: 'more',
    projectDir: '.openhands/skills',
    globalDir: '.openhands/skills',
    detect: ['.openhands'],
    mcp: [settingsUi],
  },
  {
    id: 'qwen-code',
    label: 'Qwen Code',
    group: 'more',
    projectDir: '.qwen/skills',
    globalDir: '.qwen/skills',
    detect: ['.qwen', 'QWEN.md'],
    mcp: [json('.qwen/settings.json', 'mcpServers', (url) => ({ httpUrl: url }))],
  },
  {
    id: 'universal',
    label: 'Other / generic agent (.agents/skills)',
    group: 'more',
    projectDir: '.agents/skills',
    globalDir: '.agents/skills',
    detect: [],
    mcp: [manual('your agent\'s MCP config', (name, url) => jsonSnippet('mcpServers', { url })(name))],
  },
  {
    id: 'claude-app',
    label: 'Claude app (web, desktop)',
    group: 'chat',
    detect: [],
    mcp: [],
    after:
      'Claude app: Customize > Skills > + > Upload a skill, once per zip (needs "Code execution" on). Connect the MCP under Customize > Connectors > Add custom connector.',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    group: 'chat',
    detect: [],
    mcp: [],
    after:
      'ChatGPT: Skills > Create > Upload from your computer, once per zip (workspace admins may need to allow skill uploads). Connect the MCP under Settings > Apps > Create (Developer mode).',
  },
]

export const GROUP_LABELS: Record<AgentGroup, string> = {
  popular: 'Popular coding agents',
  more: 'More coding agents',
  chat: 'Chat apps (exports .zip to upload)',
}

export function findAgent(id: string): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id)
}

/** The agency connector's server name. Must match AGENCY_SERVER_NAME in apps/cms/src/lib/mcp-install.ts. */
export const AGENCY_SERVER_NAME = 'areca-agency'

/** `<cms>/api/agency/mcp`, with an optional trailing slash. */
const AGENCY_PATH = /\/api\/agency\/mcp\/?$/
/** `<cms>/api/mcp/<site-slug>`, with an optional trailing slash. */
const SITE_PATH = /\/api\/mcp\/[^/]+\/?$/

/** True for the agency-wide connector URL `<cms>/api/agency/mcp`. */
export function isAgencyConnectorUrl(connectorUrl: string): boolean {
  return AGENCY_PATH.test(new URL(connectorUrl).pathname)
}

/**
 * `areca-<slug>` from a site connector URL `…/api/mcp/<slug>`, matching the CMS
 * install buttons. The agency URL `…/api/agency/mcp` is `areca-agency`.
 */
export function mcpServerName(connectorUrl: string): string {
  if (isAgencyConnectorUrl(connectorUrl)) return AGENCY_SERVER_NAME
  const slug = new URL(connectorUrl).pathname.split('/').filter(Boolean).at(-1) ?? ''
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `areca-${clean || 'site'}`
}

/**
 * Accepts a site connector `https://cms/api/mcp/<slug>` or the agency connector
 * `https://cms/api/agency/mcp` (http on localhost). Returns an error message or undefined.
 */
export function validateConnectorUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Enter a full URL, e.g. https://cms.example.com/api/mcp/acme-site or https://cms.example.com/api/agency/mcp'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use an http(s) URL'
  if (!AGENCY_PATH.test(url.pathname) && !SITE_PATH.test(url.pathname)) {
    return 'Use the connector URL from Connect AI: <cms>/api/mcp/<site-slug> for one site, or <cms>/api/agency/mcp for the agency connector'
  }
  return undefined
}
