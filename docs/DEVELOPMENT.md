# Working on Areca

Areca is a pnpm workspace with the CMS, site SDK, and demo website. Use [onboarding](ONBOARDING.md) for the initial database, storage, environment, and account setup. Use [architecture](ARCHITECTURE.md) to find the right part of the source.

## Local workflow

The repository's CI and CMS Dockerfile currently use Node 24 and pnpm 12. Use the pinned versions recorded in `.github/workflows/ci.yml` and `apps/cms/Dockerfile` when reproducing CI.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The CMS runs on port 3000. Infrastructure comes from the root `docker-compose.yml`. The demo site runs separately on port 3001:

```sh
pnpm --filter @areca-cms/site-sdk build
pnpm --filter @areca/demo-site dev
```

Follow [the demo README](../examples/demo-site/README.md) to push its manifest and generate content first. The SDK's workspace package exports built `dist` files, so rebuild it after SDK changes.

Do not point local reset, seed, migration experiments, or integration tests at production resources. The root scripts forward to the CMS package; commands inside a package use that package's working directory and environment.

## Repository instructions

Before substantial edits, follow the root `AGENTS.md`: list local intent skills from the workspace root and load matching guidance. Additional instructions in a package apply to that package. The SDK, CMS, and demo are separate packages even though they share a lockfile.

## Checks

Run checks for the affected package:

| Change | Checks |
| --- | --- |
| SDK | `pnpm --filter @areca-cms/site-sdk typecheck`, `pnpm --filter @areca-cms/site-sdk test` |
| CMS | `pnpm --filter @areca/cms typecheck`, relevant unit tests, `pnpm --filter @areca/cms test:scripts` for scripts |
| Demo website | SDK build first, then `pnpm --filter @areca/demo-site typecheck` and `pnpm --filter @areca/demo-site test` |
| Recovery tooling | `node --test docker/*.test.mjs` |
| Documentation | Verify commands and examples against source; check links, screenshots, and `git diff --check` |

CMS typechecking compiles Paraglide output before running TypeScript. Building or starting the dev server can generate routes and translation output. These are normal code-development commands, so skip them when a task permits documentation changes only.

### Unit tests without services

CMS tests include suites requiring PostgreSQL, S3, or SMTP. CI deliberately excludes those suites with `SKIP_INTEGRATION_TESTS=true`. To run only that subset locally on a POSIX shell:

```sh
SKIP_INTEGRATION_TESTS=true pnpm --filter @areca/cms test
```

In PowerShell, set `$env:SKIP_INTEGRATION_TESTS = 'true'`, run the test command, then remove the variable. Skipping integration suites verifies only the remaining unit tests; it does not validate database or external service behavior.

### Integration and browser tests

Regular `pnpm test` includes service-dependent suites and can change test data. Use a dedicated test database and bucket. In particular, ordinary `pnpm test:e2e` runs a setup project that clears the configured database and upload bucket. Never use it against a stack whose data you want to retain.

The provided isolated browser workflow provisions `areca_e2e`, bucket `areca-e2e`, Redis DB 1, and a CMS on port 3100:

```sh
pnpm --filter @areca/cms test:e2e:isolated
pnpm --filter @areca/cms test:e2e:qa:isolated
```

The first command runs setup and functional Chromium tests. The second runs the QA walkthrough. Infrastructure must be running; the isolated script handles its test database and bucket migrations. `PW_CHROMIUM_PATH` selects a local Chromium binary, `QA_SCREENSHOT_DIR` selects the walkthrough image directory, and `PLAYWRIGHT_BASE_URL` selects the server for non-isolated runs. Read `apps/cms/scripts/e2e-isolated.mjs` before changing its assumptions.

### Build and security checks

CI checks SDK/CMS/demo types and tests, recovery and CMS scripts, a CMS build, client-bundle secret scanning, and Git-history secret scanning. `pnpm --filter @areca/cms scan:client` inspects existing build output; build first in a normal code-development workflow. See `.github/workflows/ci.yml` for the exact CI environment and `.gitleaks.toml` for secret scanning.

## Database changes

Drizzle's source schema lives in `apps/cms/src/db/schema.ts`; committed migrations live in `apps/cms/drizzle`. Use `pnpm db:generate` to produce a migration and `pnpm db:migrate` to apply migrations in development. Review generated SQL. Avoid `db:push` as a production upgrade workflow because it bypasses the reviewed migration sequence.

Use [upgrades](UPGRADES.md) for production migration, staging validation, backups, and rollback. `db:reset` erases application data and the configured upload bucket; it is a deliberate local reset tool rather than a setup prerequisite.

## Releasing packages

`@areca-cms/site-sdk` and `@areca-cms/skills` are published to npm by `.github/workflows/release.yml`, using `scripts/release/release.mjs`. Each package has its own version, tags (`site-sdk-v0.3.0`, `skills-v0.2.0`), `CHANGELOG.md` and release PR.

1. A push to `master` that touches a package's files runs the workflow. For the site SDK, that is `packages/site-sdk/`. For skills, it is `packages/skills/`, `skills/` and `.claude-plugin/`.
2. Commit subjects since the package's last tag decide the bump. Merge commits are ignored. `feat:` bumps minor, `fix:` and `perf:` bump patch, and `!` or a `BREAKING CHANGE:` footer bumps major. Below 1.0.0, a breaking change bumps minor. `docs:`, `chore:`, `test:`, `ci:`, `refactor:` and `style:` don't release.
3. The workflow opens or updates a `release/<package>` PR with the new version and changelog. It rebuilds the PR on every push, so don't edit it by hand.
4. Merging the PR publishes the version to npm and creates the tag and GitHub Release. The workflow first typechecks, tests, builds and packs the package. A separate job then publishes the tarball, so the npm credential is never available to tests or builds.

To release without a qualifying commit, or to go to 1.0.0, run **Release packages** from the Actions tab and choose a package and bump. `node --test scripts/release/*.test.mjs` tests the bump and changelog logic.

The workflow needs no npm token. It needs the following:

- npm trusted publishing (OIDC) for each package. In the package's settings on npmjs.com, add a GitHub Actions trusted publisher for `ekozf/areca-cms` with workflow file `release.yml`. A new trusted publisher configuration must publish within 2 days or it expires, so add it just before merging that package's release PR. Renaming the workflow file breaks publishing until you update the configuration. Provenance isn't generated while the repository is private.
- A GitHub App installed on this repository only, with Contents and Pull requests read and write. Store its client ID in the `RELEASE_APP_CLIENT_ID` repository variable and a private key in the `RELEASE_APP_PRIVATE_KEY` secret. CI only runs on the release PR because the PR is opened with the App's token.

## Documentation maintenance

Update the guide for the affected audience and link it from [the documentation index](README.md). Keep code examples small but usable; identify required variables and prerequisites. Describe current behavior separately from planned work. Keep historical proposal documents labeled as such.

For a screenshot, wait until loading placeholders disappear, capture the actual interface, and avoid revealing tokens, recovery codes, or private content. Store images under `docs/screenshots` and record context in [screenshot notes](screenshots/README.md). Capturing an existing screen should not require publishing, deleting, or resetting user data.
