# Run the CMS with Docker

This local demo uses the published CMS image with PostgreSQL, Redis, RustFS
(S3 storage), and Mailpit (email inbox). Docker selects AMD64 or ARM64 automatically.
No customer site is included. Requires Docker with Compose v2.

From this directory:

```sh
cp .env.example .env
# Edit .env: generate BETTER_AUTH_SECRET with openssl rand -hex 32
# and DOKPLOY_CREDENTIALS_ENCRYPTION_KEY with openssl rand -base64 32;
# replace the demo database and S3 credentials too.
docker compose up -d --wait
```

The values in `.env.example` are for trying the local demo. Replace them before
using a shared or public instance. Keep `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY`
stable and backed up with PostgreSQL; it is required even if you do not use
Dokploy yet. If you enable AI settings, also generate and retain
`AI_SETTINGS_ENCRYPTION_KEY`. See [CMS configuration](../docs/CONFIGURATION.md).

Open <http://localhost:3000/setup> to create the first administrator. The setup
form asks for a setup token: set `SETUP_TOKEN` (16+ characters) in `.env`, or
leave it unset and read the generated token from `docker compose logs cms`
(printed once, the first time the CMS is opened while no account exists). The
first administrator is then asked to turn on two-factor authentication.
The database starts empty; no demo accounts are seeded. Startup automatically applies migrations
and creates the `areca` bucket. Mailpit is at <http://localhost:8025> and the RustFS
console at <http://localhost:9001> (use the S3 credentials from `.env`).

The example binds the CMS, RustFS console, and Mailpit UI to localhost and keeps
database, Redis, and the S3 API ports internal. For a different CMS port, update
both `CMS_PORT` and `CMS_URL`. For public hosting, configure a reverse proxy,
public `CMS_URL`, real SMTP, and unique service credentials; consult
[deployment](../docs/DEPLOYMENT.md). Agency administrators need TOTP by default.
For first-run setup, the CMS generates a one-time setup token and prints it to
the CMS log unless `SETUP_TOKEN` is set. Do not commit `.env`.

```sh
docker compose logs -f cms
docker compose pull && docker compose up -d --wait
docker compose down
```

Named volumes retain database, Redis, and uploaded media across restarts and
`down`. `docker compose down --volumes` deletes all demo data.

## Build locally

From the repository root:

```sh
docker build -f apps/cms/Dockerfile -t areca-cms:local .
cd docker
CMS_IMAGE=areca-cms:local docker compose up -d --wait
```

The Dockerfile pins Node 24.21.0 (latest LTS) and pnpm 12.8.1 (latest stable as of
2026-10-01). Override `NODE_VERSION` and `PNPM_VERSION` using `--build-arg` when
upgrading. Dependencies use the frozen lockfile; only CMS files enter the build
context. Dependency layers are reused across source changes. The runtime runs as
`node` and contains Nitro's traced output, migrations, and a bundled startup script.

## GitHub Actions and image tags

Two workflows build natively on `ubuntu-24.04` (AMD64) and `ubuntu-24.04-arm`
(ARM64), using separate GitHub Actions BuildKit caches. The AMD64 release workflow
runs on matching pushes to `master`. It first calls the CI workflow (typecheck,
unit tests, secret scan and client bundle scan); only if that passes does it build,
in parallel, AMD64 and the reusable ARM64 workflow. It only publishes a shared manifest after both builds succeed, using their exact
digests so architectures always come from the same commit.

Matching paths include `apps/cms/**`, root dependency configuration, the Docker
workflows, `.dockerignore`, and `docker/**`. Other applications are neither built
nor copied into the image.

In GitHub's **Actions** tab:

- Run **CMS Docker AMD64 and multi-platform release** to build both architectures
  and publish shared tags.
- Run **CMS Docker ARM64** to rebuild only ARM64 tags. It does not change the
  shared manifest; run the release workflow to update that.

Tags under `ghcr.io/ekozf/areca-cms`:

| Tag                                                          | Content                                      |
| ------------------------------------------------------------ | -------------------------------------------- |
| `latest`                                                     | Both architectures, updated only from `master` |
| `latest-amd64`, `latest-arm64`                               | Architecture-specific images from `master`   |
| `sha-<full-commit-sha>`                                      | Both architectures for that commit           |
| `sha-<full-commit-sha>-amd64`, `sha-<full-commit-sha>-arm64` | A specific commit and architecture           |

Manual runs on other branches publish only commit tags. Commit tags provide a
stable reference to source; use an image digest when you need registry-enforced
immutability. No additional registry secret is needed: workflows use
`GITHUB_TOKEN` with `packages: write` and link the package to the repository using
the OCI source label.

After the first publish, open the repository's **Packages** entry, then **Package
settings → Change visibility → Public** to allow visitors to pull without login.
[GitHub defaults new container packages to private](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

`latest` is for trying the demo. For anything that matters, set `CMS_IMAGE` to a
`sha-<full-commit-sha>` tag or an image digest so restarts never pick up a new
release unannounced. The third-party images in `compose.yml` use explicit version
tags. See [../docs/UPGRADES.md](../docs/UPGRADES.md) for the upgrade and rollback
procedure.

Backup, isolated restore and versioned organization transfer: [RECOVERY.md](RECOVERY.md).
