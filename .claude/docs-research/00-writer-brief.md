# Writer brief: Areca public docs site

You are writing pages for the public documentation site of **Areca**, a CMS for agency-managed websites, plus its site SDK (`@areca-cms/site-sdk`). The site is at `apps/docs` (Fumadocs on TanStack Start). Read this whole brief before writing.

## Where things are

- Pages: `apps/docs/content/docs/<section>/<slug>.mdx`. You only create or overwrite the files assigned to you. **Do not edit `meta.json` files, anything in `apps/docs/src`, or any file outside your assignment.**
- Authoring reference (frontmatter, components, links): `apps/docs/README.md`. Read it.
- Style example: `apps/docs/content/docs/(start)/index.mdx`.
- Research notes (already extracted from the old docs and the code):
  - `.claude/docs-research/01-product-guides.md`: CMS guide, admin guide, onboarding, content schema, SEO, architecture, MVP status
  - `.claude/docs-research/02-sdk-api-config.md`: SDK, API, integrations, configuration, development, troubleshooting
  - `.claude/docs-research/03-ops-deploy-security.md`: deployment, operations, recovery, upgrades, capacity, asset retention, authz matrix, decisions, Docker
  - `.claude/docs-research/04-sdk-code.md`: the SDK's actual API from source code (authoritative for the SDK)
  - `.claude/docs-research/05-cms-code.md`: CMS routes, features, UI strings, env vars, roles, endpoints from source code
- The original docs (`docs/*.md`), and the source code itself (`apps/cms/src`, `packages/site-sdk/src`, `examples/demo-site`, `docker/`). The UI strings are in `apps/cms/messages/en.json`; use the exact English labels for buttons, tabs and menus.

## Accuracy rules (most important)

1. **The code is the source of truth.** The old docs contradict each other in places. When the research notes flag a contradiction, or you are unsure, open the source file and check. Never invent commands, flags, env vars, endpoints, limits or UI labels.
2. If you cannot settle a question from the code, leave the uncertain claim out of the page (or describe it conservatively), and record it in `.claude/docs-research/issues/<your-writer-id>.md` as `- <page>: <question> (evidence: <files>)`. Never put TODOs, "unverified" notes, or internal file paths like `apps/cms/src/...` in public pages.
3. Do not document internal implementation details readers can't act on (internal function names, database table names, file paths inside the CMS source). Public interfaces are fine: env vars, CLI, SDK exports, HTTP endpoints, UI labels, Docker/compose service names, config files.
4. Never include real secrets. Use placeholders such as `areca_site_xxx` or `<your-site-token>`.

## Audience and scope

The public docs cover: **user and developer guides, self-hosting and operations, security**. They exclude contributor internals (local repo development, architecture decision records, design system, implementation status). Write for the reader of your section:
- CMS guide: non-technical editors and agency admins. No code. Name the UI exactly as it appears.
- SDK & API: web developers integrating a website.
- Self-hosting: operators running Areca with Docker.
- Security: admins and operators evaluating or configuring Areca.

## Style

- Plain, direct English, second person ("you"), present tense, active voice. Short paragraphs. American spelling is fine, but be consistent within a page.
- Every page starts with frontmatter containing `title` (sentence case, no "Areca" prefix needed) and `description` (one complete sentence, under 160 characters, used in search and link previews). Do not repeat the title as an H1 in the body; start with an intro paragraph, then `##` sections.
- Lead with what the reader is trying to do. Explain why when it isn't obvious.
- Use `<Steps>` for procedures, `<Callout type="warn">` for data loss or security risks, `<Tabs>` for package-manager or OS alternatives, `<TypeTable>` or Markdown tables for options/env vars/fields, and code blocks with a language and `title="file"` where it helps. Don't overuse callouts; at most about three per page.
- Use consistent terms: client, site, collection (UI may say "content type"; mention both once), entry, draft, ready, live, release, Go live, snapshot, site token, agency admin, client owner, client editor. Check `.claude/docs-research/01-product-guides.md` for the glossary.
- Screenshots exist in `apps/docs/public/screenshots/` (reference as `/screenshots/<file>.png`): current-agency-ai, current-branding, current-collection, current-content-schema, current-deployment-settings, current-developer-settings, current-editor-answers, current-editor-seo, current-library, current-mobile-collection, current-people, current-releases, current-seo-search, two-factor-authentication. Use one where it genuinely helps, with descriptive alt text. Each screenshot should be used on at most one or two pages.
- Pages should be thorough but scannable: typically 80–250 lines of MDX. Reference pages can be longer.
- End with a short "Related" or "Next steps" list of links where useful.

## MDX gotchas

- In MDX, `{`, `}`, `<` and `>` in plain prose are parsed as JSX. Inside code spans and code blocks they're fine. In prose, write "less than" or put the expression in backticks. Don't use HTML comments (`<!-- -->`); they break MDX.
- Leave a blank line between a component's opening tag and Markdown content inside it (see `<Step>` in the README).
- `TypeTable` takes a JS object: `type={{ name: { type: 'string', description: '...', required: true, default: '...' } }}`. Escape quotes properly.

## Links

Link with absolute paths, e.g. `[CLI reference](/docs/sdk/cli)` or `/docs/security/rate-limits#site-api`. **Only link to pages in the site map below; the build fails on a link to a page that doesn't exist.** Anchors are generated from headings (lowercase, hyphenated). Don't link to the GitHub repo or the old `docs/` folder.

## Site map (all planned pages)

**Get started** (`content/docs/(start)/`, URLs `/docs/...`)
- `/docs`: Introduction (done)
- `/docs/quickstart`: Quickstart: your first publish
- `/docs/concepts`: How Areca works
- `/docs/glossary`: Glossary
- `/docs/troubleshooting`: Troubleshooting (cross-section FAQ hub)

**CMS guide** (`content/docs/cms/`)
- `/docs/cms`: CMS guide overview
- For editors: `/docs/cms/workspace`, `/docs/cms/writing-entries`, `/docs/cms/statuses-and-review`, `/docs/cms/preview`, `/docs/cms/scheduling`, `/docs/cms/going-live`, `/docs/cms/library`, `/docs/cms/seo-and-ai`, `/docs/cms/history-and-activity`, `/docs/cms/account`
- For agency admins: `/docs/cms/clients-and-sites`, `/docs/cms/site-settings`, `/docs/cms/content-types`, `/docs/cms/people-and-invitations`, `/docs/cms/deployments`, `/docs/cms/branding`, `/docs/cms/ai-settings`

**SDK & API** (`content/docs/sdk/`)
- `/docs/sdk`: SDK overview
- Guides: `/docs/sdk/installation`, `/docs/sdk/defining-content`, `/docs/sdk/schema-sync`, `/docs/sdk/pulling-content`, `/docs/sdk/reading-content`, `/docs/sdk/rich-text`, `/docs/sdk/seo`, `/docs/sdk/preview`, `/docs/sdk/go-live-builds`, `/docs/sdk/example-site`
- Reference: `/docs/sdk/field-types`, `/docs/sdk/cli`, `/docs/sdk/client`, `/docs/sdk/http-api`, `/docs/sdk/errors-and-limits`

**Self-hosting** (`content/docs/self-hosting/`)
- `/docs/self-hosting`: Overview and requirements
- `/docs/self-hosting/docker-quickstart`, `/docs/self-hosting/production`, `/docs/self-hosting/first-run`
- `/docs/self-hosting/configuration`, `/docs/self-hosting/authentication`, `/docs/self-hosting/storage-and-email`, `/docs/self-hosting/deployment-targets`
- `/docs/self-hosting/operations`, `/docs/self-hosting/publishing-pipeline`, `/docs/self-hosting/capacity`, `/docs/self-hosting/asset-retention`
- `/docs/self-hosting/upgrades`, `/docs/self-hosting/backup-and-recovery`, `/docs/self-hosting/troubleshooting`

**Security** (`content/docs/security/`)
- `/docs/security`: Security overview
- `/docs/security/roles-and-permissions`, `/docs/security/permissions-matrix`, `/docs/security/two-factor-and-step-up`, `/docs/security/tokens`, `/docs/security/secrets`, `/docs/security/rate-limits`, `/docs/security/ai-data-handling`

## Ownership boundaries

Each topic has one home. Explain it fully on its home page, and elsewhere give a one-sentence summary plus a link. For example, environment variables live in `/docs/self-hosting/configuration`, rate limits in `/docs/security/rate-limits`, field types in `/docs/sdk/field-types`, and roles in `/docs/security/roles-and-permissions`.

## When you finish

- Do **not** run `pnpm build` or `pnpm dev`; the orchestrator builds the site after all writers finish (concurrent builds collide).
- Re-read each page once for MDX syntax problems (unescaped `{ } < >` in prose, unclosed components, HTML comments) and for links outside the site map.
- Reply with a SHORT report (under 200 words): the files you wrote, and the number of open issues you recorded in your issues file.
