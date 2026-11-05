# Contributing to Areca CMS

Thanks for taking the time to help. Bug reports, fixes, docs improvements and new ideas are all welcome.

## Before you start

- **Small fixes** (typos, docs, an obvious bug): open a pull request straight away.
- **Anything bigger** (a new feature, a new field type, a change to how publishing works): open an issue first and describe what you want to build. Areca CMS deliberately leaves some things out, and [the design decisions](docs/DECISIONS.md) explain why. Agreeing on the approach first saves you from writing code that can't be merged.
- **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md) instead.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up the workspace

You need Node 24 (see `.nvmrc`), pnpm 12 (`corepack enable` picks the pinned version) and Docker for PostgreSQL, Redis and S3-compatible storage.

```sh
git clone https://github.com/seirai-dev/areca-cms.git
cd areca-cms
pnpm install
docker compose up -d          # PostgreSQL, Redis and storage for local development
cp apps/cms/.env.example apps/cms/.env.local
pnpm db:migrate
pnpm db:demo                  # optional: fills the CMS with demo agencies, sites and content
pnpm dev                      # CMS on http://localhost:3000
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the details: environment variables, the demo website, test databases and the browser tests. [apps/cms/README.md](apps/cms/README.md) explains how the CMS app is laid out.

## What's where

| Path | What it is |
| --- | --- |
| `apps/cms` | The CMS itself (TanStack Start, PostgreSQL, Drizzle) |
| `apps/docs` | The documentation site at [docs.arecacms.com](https://docs.arecacms.com) |
| `apps/landing` | The website at [arecacms.com](https://arecacms.com) and its product video |
| `packages/site-sdk` | `@areca-cms/site-sdk`, the SDK and CLI that connect a website to the CMS |
| `packages/skills` | `@areca-cms/skills`, the installer for the agent skills |
| `skills/` | The agent skills themselves, the single source for the npm package and the Claude Code plugin |
| `examples/demo-site` | A full example website (Northbound Coffee) built with the SDK |
| `docker/` | Docker Compose for self-hosting, plus recovery tooling |
| `docs/` | Contributor notes: architecture, design decisions, permissions, design system |

## Making a change

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests. Most CMS code has unit tests next to it (`*.test.ts`); server code that touches the database has integration tests (`*.db.test.ts`).
3. Run the checks for the package you changed:

   | Changed | Run |
   | --- | --- |
   | CMS | `pnpm --filter @areca/cms typecheck` and `SKIP_INTEGRATION_TESTS=true pnpm --filter @areca/cms test` |
   | Site SDK | `pnpm --filter @areca-cms/site-sdk typecheck` and `pnpm --filter @areca-cms/site-sdk test` |
   | Skills | `pnpm --filter @areca-cms/skills test` |
   | Docs site | `pnpm --filter @areca/docs build` |

   CI runs the full set, including the database and browser tests, on every pull request.
4. Update the docs if behaviour changes. User-facing docs live in `apps/docs/content`.
5. Open a pull request and fill in the template.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org). The release tooling reads them to pick the next version and write the changelogs, so the type matters:

- `feat:` a new feature (minor release)
- `fix:` or `perf:` a bug fix or speed-up (patch release)
- `docs:`, `test:`, `refactor:`, `chore:`, `ci:` no release on their own
- `feat!:` or a `BREAKING CHANGE:` footer for breaking changes

A scope is welcome when it helps: `fix(sdk): ...`, `feat(editor): ...`.

### Code style

Prettier and ESLint are set up in each package (`pnpm --filter @areca/cms format`). Keep to the patterns already in the file you're editing. For CMS screens, [docs/DESIGN.md](docs/DESIGN.md) lists the tokens and components to reuse.

### Translations

The CMS interface is translated with Paraglide. Messages live in `apps/cms/messages/`. If you add text to the interface, add it to every language file.

## Releases

Maintainers handle releases. The CMS Docker image is tagged from `main` (see [RELEASING.md](RELEASING.md)), and the npm packages release through automated release pull requests. Contributors don't need to change version numbers or changelogs.

## License

Areca CMS is [MIT licensed](LICENSE). By opening a pull request, you agree that your contribution is released under the same license. There is no contributor agreement to sign.
