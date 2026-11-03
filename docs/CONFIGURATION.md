# CMS configuration

The CMS reads its server settings from the process environment. For local work,
copy `apps/cms/.env.example` to the gitignored `apps/cms/.env.local`; for Docker,
use `docker/.env` with `docker/compose.yml`. Keep the same values on every CMS
process that shares a database. Never commit either environment file.

## Required settings

The CMS validates these when the server starts. The encryption key must be
present even when no Dokploy account has been configured yet.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `BETTER_AUTH_SECRET` | Signs authentication sessions. Keep stable; changing it signs everyone out. |
| `BETTER_AUTH_URL` | Canonical CMS URL used by authentication callbacks. Include the public scheme and host. It is also the OAuth issuer (`<BETTER_AUTH_URL>/api/auth`) that AI apps sign in with. |
| `APP_URL` | CMS origin included in invitation and asset URLs, and the origin of each site's connector URL (`/api/mcp/<site-slug>`) shown on the Connect AI page. Set it to the public HTTPS origin, reachable by the browser, any site build that fetches assets, and the AI apps that connect. Use the same origin as `BETTER_AUTH_URL`. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3-compatible object storage for uploaded assets and branding. |
| `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` | Base64-encoded 32-byte key that encrypts organization Dokploy credentials in PostgreSQL. |

`S3_ENDPOINT` should be the storage service's internal address, such as
`http://rustfs:9000` on the Docker network, not its public HTTPS URL. The CMS
proxies asset bytes itself, so browsers never contact the storage host.

Generate independent secrets rather than reusing example values:

```sh
openssl rand -hex 32       # BETTER_AUTH_SECRET
openssl rand -base64 32    # DOKPLOY_CREDENTIALS_ENCRYPTION_KEY
```

In production (`NODE_ENV=production`) the CMS refuses to start when `REDIS_URL`
is unset, when `BETTER_AUTH_SECRET` is an example value (`change-me`, or a value
starting with `replace-` or `replace_`), or when an encryption key is all zero
bytes. The error names the setting and repeats the `openssl` command.

Keep the Dokploy encryption key with the database backup. There is no automatic
re-encryption: changing or losing it makes saved Dokploy credentials unreadable.
The same applies when restoring a database; restore the matching key. See the
[recovery guide](RECOVERY.md) and the detailed
[Docker recovery runbook](../docker/RECOVERY.md).

## URLs and local networking

For the local Compose stack, the CMS runs on `http://localhost:3000`, the demo
site on `http://localhost:3001`, PostgreSQL on `localhost:5432`, RustFS S3 on
`localhost:9000`, and Mailpit's inbox on `http://localhost:8025`. Inside Compose,
service names are used instead: `postgres`, `rustfs`, `mailpit`, and `redis`.

`BETTER_AUTH_URL` must match the URL users use to open the CMS so OAuth and SSO
callbacks land on the right origin. AI apps use it as the OAuth issuer, so it
must be the public HTTPS origin, and `APP_URL` must be the same origin. See
[AI apps need public HTTPS](DEPLOYMENT.md#ai-apps-need-public-https). `APP_URL` is used to create invitation and
asset links. For Dokploy builds, the CMS and its asset URLs must be reachable
from the Dokploy host; `localhost` there means the Dokploy container itself.
See [deployment](DEPLOYMENT.md) for the LAN and public-host setup.

The CMS also accepts these optional URL and storage settings:

| Variable | Default or effect |
| --- | --- |
| `SERVER_URL` | Optional server URL override. Usually leave unset. |
| `REDIS_URL` | `redis://localhost:6379` outside production. Required in production (no default there). Holds the shared rate-limit counters. While Redis is down, each instance keeps counting in memory with the same budgets, and the health check reports Redis as degraded. |
| `S3_PREFIX` | Unset or exactly empty uses the bucket root. Optional installation path such as `areca` or `sites/production`; `/areca/` normalizes to `areca`. See below before changing it. |
| `S3_FORCE_PATH_STYLE` | `false`; set `true` for path-style S3 endpoints such as local RustFS/MinIO. |

## Storage prefix

A private bucket may be dedicated to Areca or shared with a separate `S3_PREFIX`
for each installation. All object reads, writes and deletes, including branding,
cleanup and authoring export/import, use the normalized prefix plus `/` exactly
once at the S3 boundary. Database keys, bundle logical keys and public URLs stay
unchanged. There is no root fallback. Invalid nonempty values fail before storage
operations: slash-only values, whitespace/control characters, backslashes,
repeated internal `/`, and `.` or `..` segments are rejected.

Use the same setting for every CMS process and standalone maintenance script.
Reset lists and deletes the entire subtree, including manually placed objects,
without touching neighboring prefixes; unset/empty retains whole-bucket reset.
Bucket Head/Create and readiness stay bucket-level and do not test prefix rights.
The setting does not limit credential permissions: apply provider policies as
needed. Keep the bucket private; assets served by the CMS remain public.

On AWS S3, bucket checks require bucket-wide `s3:ListBucket` without a
prefix-only condition. This also permits listing other prefixes' object names;
object Get/Put/Delete permissions can still be limited to the installation's
subtree. S3-compatible providers may have different permission models. See the
[bucket-check permission example](../apps/docs/content/docs/self-hosting/storage-and-email.mdx#bucket-check-permissions).

Existing objects require a manual move, with all CMS and maintenance writers
stopped and a consistent database/object backup. Copy only this installation's
Areca-owned objects, preserving relative keys; never recursively copy an entire
shared bucket into itself. Verify before deleting originals, then restart every
writer with the same prefix. After new writes, rollback requires reverse-syncing
changes (including deletions) with writers stopped, or restoring the pre-change
database/object snapshot together; changing the variable alone is insufficient.
There is no automatic migration. See the full
[storage guide](../apps/docs/content/docs/self-hosting/storage-and-email.mdx).

Build the migration inventory from `asset.storage_key`, `branding.logo_key`,
`branding.favicon_key` and pending `storage_object_deletion.storage_key` rows.
Deduplicate keys, omit nulls and retain the deletion queue; queued objects may
already be absent. Logical key validation also applies in root mode: empty keys
or path segments, `.`/`..` segments, backslashes and control characters are
rejected. App-generated keys comply; inspect unusual legacy keys before upgrading.

## Authentication and integrations

Email/password sign-in is enabled by default. `AUTH_EMAIL_PASSWORD_ENABLED=false`
removes its form and rejects password sign-in. The first `/setup` account still
uses a password so the instance cannot be locked out. Provider sign-in is
enabled by setting both credentials for a provider:

| Provider | Settings | Callback URL |
| --- | --- | --- |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/github` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `<BETTER_AUTH_URL>/api/auth/callback/discord` |
| Microsoft Entra ID | `MICROSOFT_SSO_CLIENT_ID`, `MICROSOFT_SSO_CLIENT_SECRET`, `MICROSOFT_SSO_TENANT_ID` | `<BETTER_AUTH_URL>/api/auth/sso/callback/microsoft` |

Entra requires a concrete directory/tenant ID; `common` is not supported. Its
optional `MICROSOFT_SSO_DOMAIN` helps route a matching email domain to the
provider. Restart the CMS after changing these settings. Sign-in remains
invite-only. Agency administrators must enroll in TOTP by default;
`ADMIN_MFA_REQUIRED=false` is only for isolated development or end-to-end test
stacks.

`VITE_APP_TITLE` optionally changes the browser-visible app title; it is a
client setting, not a secret. Client-exposed variables must use the `VITE_`
prefix. All other values in this guide are server-side configuration.

`AI_SETTINGS_ENCRYPTION_KEY` is optional. It uses a separate base64-encoded
32-byte key to encrypt the OpenRouter key saved under `/agency/ai`. Without it,
AI SEO generation remains unavailable. Changing it means entering the provider
key again. Generate it with `openssl rand -base64 32` and retain it securely.

See [integrations](INTEGRATIONS.md) for the site token, schema-write token,
Dokploy delivery, invitation email behavior, and credential rotation.

## Mail

SMTP is optional at startup. Without a mail server, mail is off until one is set
in Agency → Mail. Invitations still work, and a pending invitation's link can be shared
with Regenerate link (the old link stops working).

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Mail server and sender. `SMTP_FROM` should be an address on a verified domain. Sending needs a From address, here or in Agency → Mail. |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional SMTP sign-in. |
| `SMTP_SECURE` | `starttls` (default; port 587), `tls` (port 465) or `none`. `none` is only for localhost and private-network hosts, and is the default for those. |
| `SMTP_REPLY_TO` | Optional reply-to address. |
| `SECRETS_ENCRYPTION_KEY` | Base64-encoded 32-byte key that encrypts the SMTP password saved in Agency → Mail. Falls back to `AI_SETTINGS_ENCRYPTION_KEY`. Generate with `openssl rand -base64 32`. |

Settings saved in Agency → Mail replace the `SMTP_*` variables entirely. The CMS
always verifies the server certificate and uses 15-second connection timeouts.
Failed sends are retried about 1 and 5 minutes after the first try. See
[INTEGRATIONS.md](INTEGRATIONS.md#invitation-recovery) for the delivery behavior.

Account emails use the same settings: password reset, email verification and
security notices (password changed, two-factor turned on or off, removed from a
client, role changed). Without a mail server, security notices are skipped and
forgot password asks the person to contact an agency admin. The reset token in
the email queue is encrypted with `SECRETS_ENCRYPTION_KEY`, or
`AI_SETTINGS_ENCRYPTION_KEY` if that is unset. Without a key, a reset email is
tried once and never retried. Invitation emails follow the same rule, and only
their hash is stored, so the link is never kept in plain text.

## Deployment and safety switches

| Variable | Default | Use |
| --- | --- | --- |
| `WORKER_ENABLED` | `true` | Runs publication workers and schedule processing in this CMS process. Set false only during maintenance or when publication and scheduled publishing are intentionally paused. |
| `WORKER_CONCURRENCY` | `2` | Maximum concurrent build jobs per process, from 1 to 16. |
| `WORKER_DRAIN_TIMEOUT_MS` | `8000` | How long shutdown waits for active jobs. Keep below the container stop grace period. |
| `DOKPLOY_DEV_FALLBACK_ENABLED` | `false` | Allows the legacy process-wide `DOKPLOY_URL` and `DOKPLOY_API_KEY` pair in non-production development only. Production ignores this fallback. |
| `DOKPLOY_URL`, `DOKPLOY_API_KEY` | unset | Legacy process-wide Dokploy connection, used only when the development fallback above is enabled. Normal deployments save credentials per organization in the CMS. |
| `DOKPLOY_ALLOW_INSECURE_HTTP` | unset | Allows HTTP Dokploy API URLs. Use only for isolated local/LAN development; production requires HTTPS. |
| `ALLOW_PRIVATE_HEALTH_CHECKS` | unset | Allows private or local health-check targets for Dokploy. Use only for isolated local/LAN development. |
| `CSP_REPORT_ONLY` | `false` | Sends the Content-Security-Policy as `Content-Security-Policy-Report-Only`: violations are logged by the browser and nothing is blocked. The default enforces the policy. See [operations](OPERATIONS.md#content-security-policy). |
| `RATE_LIMIT_TRUST_PROXY` | `false` | Use forwarding headers for client IP only when a trusted reverse proxy replaces those headers. |
| `SETUP_TOKEN` | generated while first account is absent | Optional first-run `/setup` token; if supplied, it must be at least 16 characters. If omitted, the process generates and logs one while setup is needed. |

Do not enable the private-network or insecure-HTTP switches on a public CMS.
They are deliberate development exceptions for Dokploy connectivity.

## Operations settings

Health, metrics, logging, database deadlines, and readiness thresholds are
documented in [operations](OPERATIONS.md). Common optional settings are:

| Variable | Default | Use |
| --- | --- | --- |
| `METRICS_TOKEN` | unset | Bearer token of at least 16 characters for `/api/metrics`; unset returns 404. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, or `silent`. |
| `STARTUP_DEADLINE_SECONDS` | `60` | Total time the container may wait for PostgreSQL, the migration lock and S3 at startup. When it passes, startup exits with code 1. See [operations](OPERATIONS.md#startup). |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | PostgreSQL connection wait limit; `0` disables it. |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Per-query PostgreSQL statement deadline; `0` disables it. |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | Closes transactions idle while holding a connection or lock; `0` disables it. |
| `DB_POOL_MAX` | `10` | Max PostgreSQL connections in this process's main pool. Each process also opens up to 4 each for MCP grants and factor locks. |
| `READINESS_TIMEOUT_MS` | `3000` | Per-dependency readiness deadline. |
| `READINESS_MAX_QUEUE_AGE_SECONDS` | `900` | Oldest queued build age before readiness fails. |
| `READINESS_MAX_TICK_AGE_SECONDS` | `300` | Worker/scheduler heartbeat and stale-lease age before readiness fails. |

## Applying changes

After changing server environment settings, restart the CMS process or container.
Do not print secret values in logs or issue reports. Rotate compromised secrets
at the affected provider or service, then update the CMS configuration and
follow [deployment secret rotation](DEPLOYMENT.md#secret-handling). Changing
`BETTER_AUTH_SECRET` invalidates sessions; changing an encryption key makes the
data encrypted with its old value unreadable until the original key is restored.
