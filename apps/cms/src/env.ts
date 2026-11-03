import { createEnv } from '@t3-oss/env-core'
import { config } from 'dotenv'
import { z } from '#/lib/zod'

import { productionSecretProblems } from '#/lib/secret-placeholders'
import { createS3Namespace } from './adapters/storage/s3-namespace.mjs'

config({ path: ['.env.local', '.env'] })

// This safety check also applies when general env validation is skipped (builds
// and operator scripts). Invalid nonempty configuration must never mean root.
createS3Namespace(process.env.S3_PREFIX)

const skipValidation =
  process.env.SKIP_ENV_VALIDATION === 'true' ||
  process.env.npm_lifecycle_event === 'build'

export const env = createEnv({
  skipValidation,
  server: {
    SERVER_URL: z.string().url().optional(),
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url(),
    // Set to false to remove the email/password form from sign-in. The
    // one-time /setup bootstrap always accepts a password regardless.
    AUTH_EMAIL_PASSWORD_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value !== 'false'),
    // Social providers are enabled by supplying both credentials; leave them
    // unset (or blank) to remove the provider from the sign-in page entirely.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    DISCORD_CLIENT_ID: z.string().min(1).optional(),
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
    // Microsoft Entra ID SSO (OIDC). Enabled when client id + secret are set.
    MICROSOFT_SSO_CLIENT_ID: z.string().min(1).optional(),
    MICROSOFT_SSO_CLIENT_SECRET: z.string().min(1).optional(),
    // A concrete directory (tenant) id is required: the multi-tenant `common`
    // endpoint advertises a templated issuer that cannot be validated.
    MICROSOFT_SSO_TENANT_ID: z.string().min(1).optional(),
    // Optional email domain so `signIn.sso({ email })` can route to Microsoft.
    MICROSOFT_SSO_DOMAIN: z.string().min(1).optional(),
    // First-run protection: /setup requires this token. When unset and the
    // instance has no users yet, one is generated per process and logged.
    SETUP_TOKEN: z.string().min(16).optional(),
    // Agency admins must enrol in two-factor authentication to use admin
    // functions. Set to false only for isolated e2e/dev stacks.
    ADMIN_MFA_REQUIRED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value !== 'false'),
    APP_URL: z.string().url(),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    RATE_LIMIT_TRUST_PROXY: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    // Send the Content-Security-Policy as Report-Only: browsers log violations
    // but do not block them. For rolling out a custom setup or debugging.
    CSP_REPORT_ONLY: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_PREFIX: z.string().optional(),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.string().optional(),
    // SMTP is optional: the Agency → Mail settings can replace these entirely.
    // Without either source, sending is off and invites need Regenerate link.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    SMTP_FROM: z.string().min(1).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    // Default: none for localhost / private hosts, otherwise starttls.
    SMTP_SECURE: z.enum(['starttls', 'tls', 'none']).optional(),
    SMTP_REPLY_TO: z.string().min(1).optional(),
    // Encrypts the stored SMTP password. Falls back to AI_SETTINGS_ENCRYPTION_KEY.
    SECRETS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, 'Must be a base64-encoded 32-byte key')
      .optional(),
    DOKPLOY_URL: z.string().url().optional(),
    DOKPLOY_API_KEY: z.string().optional(),
    DOKPLOY_CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, 'Must be a base64-encoded 32-byte key'),
    // Encrypts the OpenRouter API key stored by /agency/ai. Optional: AI
    // features stay unavailable until it is set.
    AI_SETTINGS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, 'Must be a base64-encoded 32-byte key')
      .optional(),
    // Encrypts the Cloudflare API tokens saved per client. Optional: the
    // Cloudflare card stays read-only until it is set.
    CLOUDFLARE_CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, 'Must be a base64-encoded 32-byte key')
      .optional(),
    // Test stub only: points the Cloudflare API client at a local server. Ignored
    // in production (see cloudflare-credentials.ts).
    CLOUDFLARE_API_BASE_URL: z.url().optional(),
    DOKPLOY_DEV_FALLBACK_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    DOKPLOY_ALLOW_INSECURE_HTTP: z.enum(['true', 'false']).optional(),
    ALLOW_PRIVATE_HEALTH_CHECKS: z.enum(['true', 'false']).optional(),
    WORKER_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value !== 'false'),
    // Max build jobs processed at once by this process (different sites).
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    // On SIGTERM/SIGINT, how long to wait for running build jobs. Keep below
    // the container stop timeout (Docker default 10s).
    WORKER_DRAIN_TIMEOUT_MS: z.coerce.number().int().min(0).default(8_000),
    // Operations: /api/metrics is 404 unless a bearer token is configured.
    METRICS_TOKEN: z.string().min(16).optional(),
    // Postgres deadlines (ms). 0 disables the respective timeout.
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
    DB_IDLE_IN_TX_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    // Max connections in the main pool of this process (pg's default is 10).
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    // Readiness (/api/health/ready) thresholds.
    READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).default(3_000),
    READINESS_MAX_QUEUE_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .default(15 * 60),
    READINESS_MAX_TICK_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .default(5 * 60),
  },

  /**
   * The prefix that client-side variables must have. This is enforced both at
   * a type-level and at runtime.
   */
  clientPrefix: 'VITE_',

  client: {
    VITE_APP_TITLE: z.string().min(1).optional(),
  },

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: {
    ...process.env,
    ...import.meta.env,
  },

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we recommend that all new projects
   * explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,
})

// Example values from docker/.env.example and apps/cms/.env.example must not
// reach a production instance. Failing at boot is cheaper than a forged session.
if (process.env.NODE_ENV === 'production' && !skipValidation) {
  const problems = productionSecretProblems(env)
  if (!process.env.REDIS_URL) {
    problems.push(
      'REDIS_URL must be set in production, e.g. redis://redis:6379. Shared rate-limit counters depend on it.',
    )
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production:\n- ${problems.join('\n- ')}`,
    )
  }
}
