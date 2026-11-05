# `@areca-cms/skills`

[![npm](https://img.shields.io/npm/v/@areca-cms/skills)](https://www.npmjs.com/package/@areca-cms/skills)
[![MIT license](https://img.shields.io/npm/l/@areca-cms/skills)](https://github.com/seirai-dev/areca-cms/blob/main/LICENSE)

Part of [Areca CMS](https://arecacms.com), the open-source CMS for agencies. [Documentation](https://docs.arecacms.com/docs/sdk/agent-skills) · [GitHub](https://github.com/seirai-dev/areca-cms)

Agent skills that teach AI coding agents and chat apps how to work with Areca CMS:

| Skill | Teaches |
| --- | --- |
| `areca-sdk` | Connecting a website with `@areca-cms/site-sdk`: tokens and env vars, `areca.config.ts`, the `areca` CLI, reading content, rich text, SEO, preview routes, Go-live builds |
| `areca-mcp` | Connecting an AI to a site's MCP server and using it: OAuth and personal keys, roles, the draft/ready/live workflow, field formats, SEO, images, every tool |
| `areca-quickstart` | Setting up Areca in a new website project: checks the project, interviews you about the content model, languages and build, wires the SDK, and makes a first release. Run it as `/areca-quickstart` |
| `areca-visual-editing` | Setting up a site for the CMS visual editor: the frame header, live updates with the bridge, site content pages, click-to-edit markers, the CMS settings, React, Next.js, Astro, SvelteKit and plain Node, and troubleshooting |

The skills are plain `SKILL.md` folders in the open [Agent Skills](https://agentskills.io) format. They have no scripts and no dependencies, so they work in any project.

## Install

```bash
npx @areca-cms/skills
```

Pick your agents in the selector (agents found in the project are preselected), then choose the skills and project or user scope. You can optionally add the MCP connector URL as well: a site's `<cms>/api/mcp/<site-slug>`, or the agency connector `<cms>/api/agency/mcp` for agency admins (it reaches every client and site, and is registered as `areca-agency`). Only the URL is written, never a secret, and each agent signs in to Areca in the browser on first use.

Non-interactive:

```bash
npx @areca-cms/skills add -a claude-code,codex,cursor -y
npx @areca-cms/skills add -a claude-code --mcp-url https://cms.example.com/api/mcp/acme-site -y
npx @areca-cms/skills add -a claude-code --mcp-url https://cms.example.com/api/agency/mcp -y   # agency connector
npx @areca-cms/skills add -a codex --global -y      # user-level folders
npx @areca-cms/skills mcp -a cursor --url https://cms.example.com/api/mcp/acme-site
npx @areca-cms/skills mcp -a cursor --url https://cms.example.com/api/agency/mcp
npx @areca-cms/skills export --out ./zips           # Claude app / ChatGPT uploads
npx @areca-cms/skills remove -a claude-code -y
npx @areca-cms/skills list                          # agent ids and folders
```

Agents that share a folder get one copy. For example, Codex, Cursor, Copilot, Gemini CLI and OpenCode all read `.agents/skills`. Re-running `add` updates the skills in place, and `remove` deletes only `areca-*` folders.

## Supported agents

**Coding agents:** Claude Code, Codex, Cursor, GitHub Copilot, OpenCode, Gemini CLI, Windsurf, Antigravity, Cline, Roo Code, Kilo Code, Kiro, Amp, Factory Droid, Goose, JetBrains Junie, Continue, Augment, Zed, Trae, Warp, OpenHands, Qwen Code, plus any other agent that reads `.agents/skills`.

**Chat apps:** the Claude app (web and desktop) and ChatGPT. Choosing one exports one `.zip` per skill:

- Claude: Customize > Skills > + > Upload a skill (code execution must be on).
- ChatGPT: Skills > Create > Upload from your computer.

MCP config is written to the project file for Claude Code (`.mcp.json`), Cursor, VS Code and Copilot, Codex, OpenCode, Gemini CLI, Roo Code, Kiro, Factory, Junie, Continue and Qwen Code. Agents with only a user-level config or a settings UI get the snippet printed instead.

## Other ways to install

- **Claude Code plugin:** `/plugin marketplace add seirai-dev/areca-cms`, then `/plugin install areca@areca-cms`.
- **skills CLI:** `npx skills add seirai-dev/areca-cms --skill areca-sdk --skill areca-mcp --skill areca-quickstart --skill areca-visual-editing`.
- **Manually:** copy `skills/areca-*` from the repository into your agent's skills folder.

## Development

The skill source lives in the repository root under `skills/`. The build copies it into this package. `pnpm test` checks the skills against the agentskills.io spec, and also checks that every SDK export, CLI command, env var and MCP tool in the monorepo is documented, and that no removed tool still is.

Releases are automated; see [Releasing packages](https://github.com/seirai-dev/areca-cms/blob/main/docs/DEVELOPMENT.md#releasing-packages). The release PR bumps `version` here, in `.claude-plugin/plugin.json` and in each `SKILL.md` `metadata.version` together (the tests enforce that they match). Commits under `packages/skills/`, `skills/` and `.claude-plugin/` count towards a skills release.
