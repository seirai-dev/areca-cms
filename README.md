# Areca

Areca is a build-time CMS for agency-managed websites. Editors write drafts; owners approve them with **Mark as ready**, then **Go live** creates a content snapshot and deploys the website. The website pulls that snapshot during its build using `@areca-cms/site-sdk`.

**[Start with the documentation](https://docs.arecacms.com)** for setup, CMS walkthroughs, SDK examples, and operations.

![Areca content editor with SEO controls](docs/screenshots/current-editor-seo.png)

## Get started

| Your task | Guide |
| --- | --- |
| Install the CMS locally and create the first admin | [Onboarding](https://docs.arecacms.com/docs/quickstart) |
| Install the published CMS image with Docker | [Docker installation](docker/README.md) |
| Write, preview, schedule, and publish content | [CMS guide](https://docs.arecacms.com/docs/cms) |
| Manage clients, sites, people, branding, and AI | [Agency admin guide](https://docs.arecacms.com/docs/cms/clients-and-sites) |
| Connect a website using the SDK | [SDK guide](https://docs.arecacms.com/docs/sdk) |
| Teach AI agents the SDK, the MCP server and the quickstart (`npx @areca-cms/skills`) | [Agent skills](packages/skills/README.md) |
| Set up a new website with an AI agent (`/areca-quickstart`) | [SDK guide](https://docs.arecacms.com/docs/sdk) |
| Define content types | [Content schemas](https://docs.arecacms.com/docs/sdk/defining-content) |
| Configure SEO and AI suggestions | [SEO guide](https://docs.arecacms.com/docs/sdk/seo) |
| Deploy and verify a customer website | [Deployment](https://docs.arecacms.com/docs/self-hosting/production) |

## How publishing works

```text
Draft → Mark as ready → Go live → Immutable snapshot
  → Website build pulls content → Dokploy deployment → Health check → Live
```

Draft edits stay separate from approved and live versions. Scheduled content uses a frozen approved version. Failed releases keep the previous live publication; rollback redeploys a saved snapshot.

**Production** mode requires a deployment target and a health response containing the expected publication ID. **Demo** mode supports local content pulls without a production deployment; its publications are labeled Demo and do not count as live.

Normal website pages read built content rather than query the CMS. Draft preview fetches from the CMS. Uploaded media URLs remain publicly accessible through the CMS, including files attached to drafts; see [media privacy](https://docs.arecacms.com/docs/self-hosting/production).

## Workspaces and roles

Each client organization has sites, owners, and editors. Site workspaces contain Overview, content types, Library, and role-specific controls. Agency admins also manage clients, sites, people, activity, branding, and AI from the Agency workspace.

- **Editors:** create and edit drafts, preview, upload media, and write image descriptions.
- **Owners:** also approve, schedule, archive, delete, publish, roll back, and manage client people.
- **Agency admins:** manage all clients and site settings, content types, branding, and integrations. MFA is required by default.

The interface supports light/dark appearance and English, Dutch, and Turkish. Interface language does not translate website content.

## Repository

| Path | Purpose |
| --- | --- |
| `apps/cms` | TanStack Start CMS, API, publishing worker and scheduler |
| `packages/site-sdk` | ESM SDK, schema helpers, CLI, rich text, preview, and SEO |
| `packages/skills`, `skills` | Agent skills for the SDK, the MCP server and the quickstart, and the `npx @areca-cms/skills` installer |
| `examples/demo-site` | TanStack Start website using generated content |
| `docker-compose.yml` | Local PostgreSQL, Redis, RustFS, and Mailpit |
| `docker` | Production Compose installation and recovery tooling |
| `docs` | User, developer, integration, and operations guides |

Local development uses Node 24 and pnpm 12; see [development](docs/DEVELOPMENT.md) and [onboarding](https://docs.arecacms.com/docs/quickstart) for commands, secrets, and migrations. The CMS runs on port 3000 and the demo site on port 3001.

Optional seed data creates `admin@areca.local`, `owner@acme.local`, and `editor@acme.local` with password `password123`. Use these only on a local demo; admin MFA enrollment or verification can still be required. A new empty instance uses `/setup` with a first-run setup token.

## Operate and maintain

Use [configuration](https://docs.arecacms.com/docs/self-hosting/configuration), [operations](https://docs.arecacms.com/docs/self-hosting/operations), [recovery](https://docs.arecacms.com/docs/self-hosting/backup-and-recovery), and [upgrades](https://docs.arecacms.com/docs/self-hosting/upgrades) for deployed instances. [Troubleshooting](https://docs.arecacms.com/docs/troubleshooting) connects common failures to the appropriate guide.

Browser tests clear their configured database and upload bucket. Use the provided isolated test stack when retaining local data; details are in [development](docs/DEVELOPMENT.md).

