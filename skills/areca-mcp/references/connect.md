# Connecting clients to the Areca MCP server

The examples use `NAME` = `areca-<site-slug>` and `URL` = `https://<cms-host>/api/mcp/<site-slug>`. Every client signs in with OAuth on first use: a browser opens, the user signs in to Areca, picks what the AI may do and approves. Only owners and agency admins see the "Allow going live" box, and it is off by default.

## Coding agents (project config, URL only, safe to commit)

| Client | File | Entry |
| --- | --- | --- |
| Claude Code | `.mcp.json` | `{"mcpServers":{"NAME":{"type":"http","url":"URL"}}}`. Or `claude mcp add --transport http NAME URL`, then `/mcp` > Authenticate. |
| Cursor | `.cursor/mcp.json` | `{"mcpServers":{"NAME":{"url":"URL"}}}` |
| VS Code / GitHub Copilot | `.vscode/mcp.json` | `{"servers":{"NAME":{"type":"http","url":"URL"}}}` |
| Copilot CLI | `.mcp.json` | `{"mcpServers":{"NAME":{"type":"http","url":"URL"}}}` |
| Codex (CLI/IDE/app) | `.codex/config.toml` (trusted projects) or `~/.codex/config.toml` | `[mcp_servers.NAME]` then `url = "URL"`. Then run `codex mcp login NAME`. |
| OpenCode | `opencode.json` | `{"mcp":{"NAME":{"type":"remote","url":"URL","enabled":true}}}`. Then run `opencode mcp auth NAME`. |
| Gemini CLI / Qwen Code | `.gemini/settings.json` / `.qwen/settings.json` | `{"mcpServers":{"NAME":{"httpUrl":"URL"}}}`. Then run `/mcp auth NAME`. |
| Roo Code | `.roo/mcp.json` | `{"mcpServers":{"NAME":{"type":"streamable-http","url":"URL"}}}` |
| Kiro | `.kiro/settings/mcp.json` | `{"mcpServers":{"NAME":{"url":"URL"}}}` |
| Factory Droid | `.factory/mcp.json` | `{"mcpServers":{"NAME":{"type":"http","url":"URL"}}}` |
| Junie | `.junie/mcp/mcp.json` | `{"mcpServers":{"NAME":{"url":"URL"}}}` |
| Amp | `.amp/settings.json` | `{"amp.mcpServers":{"NAME":{"url":"URL"}}}` |
| Continue | `.continue/mcpServers/NAME.yaml` | `name: NAME`, `version: 0.0.1`, `schema: v1`, `mcpServers: [{name: NAME, type: streamable-http, url: URL}]` |
| Antigravity / Kilo Code / Trae / Warp / OpenHands | MCP settings UI | Add a remote (Streamable HTTP) server with the URL |

These clients only have a user-level config. Merge the entry there:

| Client | File | Entry |
| --- | --- | --- |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `{"mcpServers":{"NAME":{"serverUrl":"URL"}}}` |
| Cline | Cline > MCP Servers > Configure (`cline_mcp_settings.json`) | `{"mcpServers":{"NAME":{"type":"streamableHttp","url":"URL"}}}` |
| Zed | `~/.config/zed/settings.json` | `{"context_servers":{"NAME":{"url":"URL"}}}` |
| Augment | `~/.augment/settings.json` | `{"mcpServers":{"NAME":{"type":"http","url":"URL"}}}` |
| Goose | `~/.config/goose/config.yaml` | `extensions: { NAME: { name: NAME, type: streamable_http, uri: URL, enabled: true } }` |

When you edit an existing config file, merge into the existing object. Don't replace other servers.

## Chat apps

- **Claude (web, desktop, mobile):** Customize > Connectors > + Add > Add custom connector. Name it after the site, paste the URL, then Add > Connect. Sign in and approve.
- **ChatGPT:** Settings > Apps (or Connectors) > Create. If Create isn't there, turn on Developer mode under Advanced first. Paste the URL as the MCP server URL, set Authentication to OAuth, then Create. Sign in and approve.
- **Any other app:** paste the URL wherever it asks for an MCP server, remote connector or custom connector. If it needs JSON, use `{"mcpServers":{"NAME":{"url":"URL"}}}`.

## Personal keys (scripts, CI, clients without OAuth)

- The user creates one under Connect AI > Advanced: personal keys > Create AI key. It lasts 30 days, 90 (default), 1 year or never, with optional "Allow going live". It is shown once, and each user can have up to 20 per site.
- Format: `areca_mcp_…`. Send it as the header `Authorization: Bearer <key>` to either the connector URL or `https://<cms-host>/api/mcp`, where the key decides the site.
- Keep keys out of git. Reference an env var (e.g. `ARECA_MCP_KEY`) where the client supports it.
  - Claude Code: `claude mcp add --transport http NAME URL --header "Authorization: Bearer $ARECA_MCP_KEY"`
  - JSON clients: `"headers": {"Authorization": "Bearer ${ARECA_MCP_KEY}"}` (the interpolation syntax depends on the client)
  - stdio-only clients: `npx -y mcp-remote URL --header "Authorization:${ARECA_AUTH}"` with env `ARECA_AUTH="Bearer <key>"`

## OAuth details (for custom clients)

- An unauthenticated request returns 401 with `WWW-Authenticate: Bearer resource_metadata="<cms>/.well-known/oauth-protected-resource/api/mcp/<slug>"`.
- The authorization server metadata is at `<cms>/.well-known/oauth-authorization-server/api/auth`. Dynamic client registration uses `POST <cms>/api/auth/oauth2/register`. Requests need PKCE S256 and `resource=<connector URL>`, and the scope must include `mcp`; add `offline_access` for refresh tokens.
- Access tokens (`areca_at_`) last 1 hour. Refresh tokens (`areca_rt_`) rotate on use and last 90 days from their last use. A connection idle for 90 days is revoked. The role is checked again on every request.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 401 "Sign in to connect" | Run the client's auth step (e.g. `/mcp`, `codex mcp login`) |
| 401 "Key is for a different site" | Use the connector URL of the key's site, or create a key there |
| 401 "This app is no longer connected" | Someone disconnected it in Connect AI. Reconnect. |
| 403 `mfa_required` | The agency admin must enable 2FA in Account settings |
| 404 "Site not found" | Wrong site slug in the URL |
| Go-live tools missing | Reconnect with "Allow going live" ticked (owners only), or ask an owner to press Go live |
