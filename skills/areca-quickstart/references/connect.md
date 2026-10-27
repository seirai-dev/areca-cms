# Connect the CMS

This file covers four things: the MCP connection, creating the site in the CMS, tokens, and demo mode. Use the `areca-mcp` skill for the full connection list and the tool reference.

## The connector URL

Every site has its own MCP endpoint:

```text
<cms-url>/api/mcp/<site-slug>
```

For example `https://cms.example.com/api/mcp/acme-site`. The site's **Connect AI** page in the CMS shows the exact URL. Use that page when you are unsure. The server name in the app is `areca-<site-slug>`.

The URL contains no secret. It is safe to commit in a project MCP file.

## Sign-in options

- **OAuth (preferred):** add only the URL. On first use, the app opens a browser. The user signs in to Areca, picks what the AI may do, and approves. No key is stored in a file.
- **Personal key:** the user creates it in the CMS under Connect AI › Advanced: personal keys › Create AI key. It is shown once. It starts with `areca_mcp_`. Use it only when the app cannot do OAuth. The user adds it to `.env.local` or to the app's own secret store. Never paste it into chat.

## Connect a coding agent

| App | Command or file |
| --- | --- |
| Claude Code | `claude mcp add --transport http areca-<slug> <url>`, then run `/mcp` and choose Authenticate. |
| Claude Code (project file) | `.mcp.json`: `{"mcpServers":{"areca-<slug>":{"type":"http","url":"<url>"}}}` |
| Cursor | `.cursor/mcp.json`: `{"mcpServers":{"areca-<slug>":{"url":"<url>"}}}` |
| VS Code / GitHub Copilot | `.vscode/mcp.json`: `{"servers":{"areca-<slug>":{"type":"http","url":"<url>"}}}` |
| Codex | `.codex/config.toml` with `[mcp_servers.areca-<slug>]` and `url = "<url>"`, then `codex mcp login areca-<slug>` |
| Other apps | The app's remote or HTTP MCP server setting, with the URL. The Connect AI page has the steps for each app. |

Rules for file-based config:

- Merge into the existing file. Keep the other servers.
- Do not replace a file the user already has without asking.
- Commit only the URL-based config. Never commit a key.

## Install the Areca skills too (optional)

This command writes the Areca skills and the connector into the coding agents the user picks:

```bash
npx @areca-cms/skills add --mcp-url <url>
```

It asks which agents to use. With `-y` it also needs `--agent`. Offer it only if the user wants the skills in the same step.

## Check the role

Call `get_site_info`. Read `you.role` and `cannotDo`.

| Role | What you can do |
| --- | --- |
| Editor | Read, create and edit drafts. |
| Owner | Also mark ready, archive and delete. |
| Owner with "Allow going live" | Also go live and schedule. |
| Agency admin | Also change the schema (`upsert_collection`, `upsert_global`) and languages (`set_site_languages`). Also change the publishing mode. On the agency connector (`/api/agency/mcp`), every client and site is reachable with `site`, and going live needs no flag. |

- Schema changes need an agency admin. If the user is not one, use code-first.
- Going live needs "Allow going live" on the connection, or an owner who presses Go live in the CMS.
- Agency admins need two-factor authentication on. A `403 mfa_required` means it is not on. The user must turn it on in the account settings.

## Reload after connecting

After the connector is added, the agent session may not see the tools yet.

- In Claude Code, run `/mcp` and choose Authenticate, then check that the server is connected.
- In other apps, reload the window or restart the session.
- Then call `get_site_info` again. If the tools still do not appear, check the URL and the sign-in, and read the troubleshooting table below.

## Create the site in the CMS

Creating a site and its tokens happens in the CMS, by a person with agency access. The agent cannot do it over MCP. Walk the user through these steps. Do not guess a key or a token.

1. In the CMS, open **Agency**. Create the client if it does not exist: **New client**, a name, and the suggested slug.
2. Open the client. On the **Sites** tab, select **New site**.
3. Enter the **Site name**. Keep the suggested **Site key**. It must match `siteKey` in `areca.config.ts`. Write it down.
4. Enter the **Production URL**. It is required. Use `http://localhost:<dev port>` for now (for example `http://localhost:3001`). It enables preview links.
5. Select **Create site**.
6. The next screen shows the site token. **It is shown once.** Copy it and store it in a password manager. Then select **I've saved it**.
7. The schema-write token is only needed for code-first. Get it in the site's **Settings › Developer**, under **Schema-write token**, with **Rotate schema token**. Copy it when it is shown, the same way.

If the user lost a token, rotate it in the site's **Settings › Developer** tab. Rotating a token stops the old one at once. Any build that still uses it fails until its `.env.local` is updated.

## Where each token goes

| Token | Where | Used by |
| --- | --- | --- |
| Site token | `.env.local` as `ARECA_SITE_TOKEN=` | `areca init`, `areca pull`, `areca manifest pull`, the content reads |
| Schema-write token | `.env.local` as `ARECA_SCHEMA_TOKEN=` | `areca manifest push` only (code-first) |
| MCP personal key | `.env.local` as `ARECA_MCP_KEY=` (only if the app needs it) | the MCP client |

Rules:

- The user pastes tokens into `.env.local`, or runs `areca init` in their terminal, which asks for the token with hidden input.
- Check a value by its length. Never print it.
- Never put a token in a `VITE_`, `NEXT_PUBLIC_` or `PUBLIC_` variable.
- Keep `.env.local` out of Git. `areca init` adds it to `.gitignore`. Check it.

## Demo mode and production mode

Each site has a publishing mode. New sites start in production.

- **Demo** ("Demo — no production deployment"): going live creates a demo release. `areca pull` can fetch it. Visitors never see it. No server is needed. Use it for the first release.
- **Production**: going live builds and deploys the website. It needs a Dokploy deployment target, an application ID and a health check URL. See the `areca-sdk` skill, `references/production.md`.

Set the mode in the CMS under **Settings › Deployment › Mode**. An agency admin can also ask the agent to set it. Ask the user before you change the mode.

- A site that has ever gone live in production cannot switch to demo. Change the mode in Settings › Deployment instead, or use another site for the demo.

## Troubleshooting the connection

| Symptom | What to do |
| --- | --- |
| 401, "Sign in to connect" | Run the app's sign-in step (for example `/mcp` in Claude Code, or `codex mcp login`). |
| 401, "Key is for a different site" | Use the connector URL of the key's site. |
| 401, "This app is no longer connected" | The user removed it in Connect AI. Add the connector again. |
| 403, `mfa_required` | An agency admin must turn on two-factor authentication. |
| 404, "Site not found" | The site slug in the URL is wrong. Check it on the Connect AI page. |
| Schema tools missing | The role is not agency admin. Use code-first. |
| Go-live tools missing | Reconnect with "Allow going live" ticked (owners only), or ask an owner to press Go live. |
| `429` | Wait for the `Retry-After` time. The limit is 120 requests per minute per credential. |
