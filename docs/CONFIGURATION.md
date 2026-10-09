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
| `BETTER_AUTH_URL` | Canonical CMS URL used by authentication callbacks. Include the public scheme and host. |
| `APP_URL` | CMS origin included in invitation and asset URLs. Set it to an origin reachable by the browser and any site build that fetches assets. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | S3-compatible object storage for uploaded assets and branding. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | SMTP server and sender for invitation email. |
| `DOKPLOY_CREDENTIALS_ENCRYPTION_KEY` | Base64-encoded 32-byte key that encrypts organization Dokploy credentials in PostgreSQL. |

Generate independent secrets rather than reusing example values:

```sh
openssl rand -hex 32       # BETTER_AUTH_SECRET
openssl rand -base64 32    # DOKPLOY_CREDENTIALS_ENCRYPTION_KEY
```

The current mail adapter uses these three SMTP settings and does not configure
SMTP username/password authentication. Use a trusted relay reachable from the
CMS host; do not expose an unauthenticated relay to the public internet.

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
callbacks land on the right origin. `APP_URL` is used to create invitation and
asset links. For Dokploy builds, the CMS and its asset URLs must be reachable
from the Dokploy host; `localhost` there means the Dokploy container itself.
See [deployment](DEPLOYMENT.md) for the LAN and public-host setup.

The CMS also accepts these optional URL and storage settings:

| Variable | Default or effect |
| --- | --- |
| `SERVER_URL` | Optional server URL override. Usually leave unset. |
| `REDIS_URL` | `redis://localhost:6379`; used for shared rate-limit counters. Redis failure is reported as degraded and rate limiting fails open. |
| `S3_FORCE_PATH_STYLE` | `false`; set `true` for path-style S3 endpoints such as local RustFS/MinIO. |

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
| `DB_CONNECT_TIMEOUT_MS` | `5000` | PostgreSQL connection wait limit; `0` disables it. |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Per-query PostgreSQL statement deadline; `0` disables it. |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | `30000` | Closes transactions idle while holding a connection or lock; `0` disables it. |
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
