import { sso } from '@better-auth/sso'
import {
  getOAuthProviderState,
  oauthProvider,
} from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import * as schema from '#/db/schema'
import { env } from '#/env'
import { m } from '#/paraglide/messages'
import { handleLocalFactorRequest } from '#/server/security/factor-http'
import { MfaRequiredError } from '#/lib/security-errors'
import { allowKeyedAction } from '#/server/http/rate-limit-store.server'
import { getClientIp } from '#/server/http/rate-limit'
import {
  deliverPasswordReset,
  sendAccountEmail,
  sendVerificationEmail,
} from '#/server/mail/account-emails'
import { audit } from '#/server/audit'
import { createLogger } from '#/server/log'
import {
  recordLocalMfaForToken,
  requireAdminLocalMfa,
} from '#/server/security/local-mfa'
import {
  assertEmailMayRegister,
  assertPasswordSignupMayProceed,
} from '#/server/auth/registration-gate'
import {
  MCP_ACCESS_TOKEN_PREFIX,
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_OAUTH_SCOPES,
  MCP_REFRESH_TOKEN_PREFIX,
  MCP_REFRESH_TOKEN_REUSE_SECONDS,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  ensureMcpResource,
  resourceParams,
} from '#/server/mcp/oauth-resource'
import {
  assertSingleMcpResource,
  consentReferenceFor,
  mcpOAuthAdapter,
  validateMcpRefreshGrant,
  handleMcpOAuthTokenRequest,
} from '#/server/mcp/oauth-grants'
import { normaliseRegistrationBody } from '#/server/mcp/oauth-registration'
import {
  TWO_FACTOR_MANAGEMENT_PATHS,
  assertPasswordlessFresh,
  assertTotpUriAvailable,
} from '#/server/security/passwordless-two-factor'

import {
  emailPasswordEnabled,
  microsoftSso,
  microsoftSsoTrustedOrigins,
  socialProviders,
} from './auth-providers.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function assertAuthAdminMfa(
  principal: Parameters<typeof requireAdminLocalMfa>[0],
) {
  try {
    await requireAdminLocalMfa(principal)
  } catch (error) {
    if (!(error instanceof MfaRequiredError)) throw error
    throw new APIError('FORBIDDEN', {
      code: error.code,
      message: error.message,
    })
  }
}

const authLog = createLogger('auth')

/**
 * Account mail must never fail the request that caused it. Notices are queued
 * rather than sent inline, so the request does not wait on SMTP; the outbox
 * worker sends them within seconds.
 */
async function sendQuietly(label: string, task: () => Promise<unknown>) {
  try {
    await task()
  } catch (error) {
    authLog.error(`${label} could not be sent`, { err: error })
  }
}

// Per email address and per client address. The email budget also covers
// unknown addresses, so the limit does not reveal which accounts exist.
const RESET_REQUEST_RULE = { limit: 3, windowSeconds: 60 * 60 } as const
const VERIFY_REQUEST_RULE = { limit: 3, windowSeconds: 60 * 60 } as const

function bodyEmail(body: unknown) {
  if (!isRecord(body) || typeof body.email !== 'string') return null
  return body.email.trim().toLowerCase() || null
}

/** Throws when either the address or the client IP is over its budget. */
async function assertMailRequestBudget(
  ctx: { body?: unknown; request?: Request },
  scope: string,
  rule: typeof RESET_REQUEST_RULE,
  code: string,
  message: string,
) {
  const email = bodyEmail(ctx.body)
  const ip = ctx.request
    ? getClientIp(ctx.request, env.RATE_LIMIT_TRUST_PROXY)
    : 'unknown'
  const allowed =
    (!email || (await allowKeyedAction(`${scope}-email`, email, rule))) &&
    (ip === 'unknown' || (await allowKeyedAction(`${scope}-ip`, ip, rule)))
  if (!allowed) throw new APIError('TOO_MANY_REQUESTS', { code, message })
}

type AuthEvent = {
  action: string
  userId: string
  targetType?: string
  targetId?: string
  sessionId?: string | null
  request?: Request
  ipAddress?: string | null
  userAgent?: string | null
  meta?: Record<string, unknown>
}

/**
 * Security events for the audit log: who, which account, which session, and
 * the network origin when the request is known. Never a token, code or secret.
 * A failed audit write is logged and does not undo or fail the auth request.
 */
async function auditAuthEvent(event: AuthEvent) {
  const network = event.request
    ? {
        ipAddress: getClientIp(event.request, env.RATE_LIMIT_TRUST_PROXY),
        userAgent: event.request.headers.get('user-agent'),
      }
    : {
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
      }
  try {
    await audit({
      organizationId: null,
      actorId: event.userId,
      action: event.action,
      targetType: event.targetType ?? 'user',
      targetId: event.targetId ?? event.userId,
      meta: {
        sessionId: event.sessionId ?? null,
        ...event.meta,
        ipAddress: network.ipAddress,
        userAgent: network.userAgent?.slice(0, 255) ?? null,
      },
    })
  } catch (error) {
    authLog.error(`${event.action} could not be audited`, { err: error })
  }
}

const SESSION_REVOKE_PATHS = new Set([
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
])

/**
 * Records a revocation by the signed-in caller. For a single session the
 * revoked session's id is looked up from the token, which is never logged.
 */
async function auditSessionRevocation(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const caller = await getSessionFromCtx(ctx)
  if (!caller) return
  if (ctx.path === '/revoke-session') {
    const token = isRecord(ctx.body) ? ctx.body.token : undefined
    const target =
      typeof token === 'string'
        ? await ctx.context.internalAdapter.findSession(token)
        : null
    if (!target) return
    await auditAuthEvent({
      action: 'session.revoke',
      userId: caller.user.id,
      targetType: 'session',
      targetId: target.session.id,
      sessionId: caller.session.id,
      request: ctx.request,
      meta: { revokedUserId: target.user.id },
    })
    return
  }
  await auditAuthEvent({
    action:
      ctx.path === '/revoke-sessions'
        ? 'session.revoke_all'
        : 'session.revoke_others',
    userId: caller.user.id,
    sessionId: caller.session.id,
    request: ctx.request,
  })
}

/** Sign-in endpoints whose new session is a sign-in (not a session swap). */
const SIGN_IN_PATH =
  /^\/(sign-in|sign-up|callback|sso\/callback|oauth2\/callback|two-factor\/verify-)/

/**
 * Two-factor flips arrive as user updates without the user id. The change is
 * recorded when the stored value differs, and sent after the update commits.
 */
const pendingTwoFactorChanges = new Map<string, boolean>()

const SSO_MANAGEMENT_PATHS = new Set([
  '/sso/register',
  '/sso/update-provider',
  '/sso/delete-provider',
  '/sso/request-domain-verification',
  '/sso/verify-domain',
])

const authBase = betterAuth({
  database: mcpOAuthAdapter(drizzleAdapter(db, { provider: 'pg', schema })),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [
    new URL(env.BETTER_AUTH_URL).origin,
    new URL(env.APP_URL).origin,
    ...microsoftSsoTrustedOrigins,
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:3000', 'http://127.0.0.1:3000']),
  ],
  emailAndPassword: {
    enabled: emailPasswordEnabled,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      await sendQuietly('password reset email', () =>
        deliverPasswordReset({ user, token }),
      )
    },
    onPasswordReset: async ({ user }) => {
      await auditAuthEvent({ action: 'user.password_reset', userId: user.id })
      await sendQuietly('password changed email', () =>
        sendAccountEmail({
          kind: 'password_changed',
          userId: user.id,
          params: { userId: user.id, at: new Date().toISOString() },
        }),
      )
    },
  },
  emailVerification: {
    sendOnSignUp: false,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user }) => {
      await sendQuietly('verification email', () =>
        sendVerificationEmail(user.id),
      )
    },
  },
  // Mail goes out in the background, so a reset request for an address with an
  // account takes as long as one without. See `runInBackgroundOrAwait`.
  advanced: {
    backgroundTasks: {
      handler: (task) => {
        task.catch((error: unknown) => {
          authLog.error('background auth task failed', { err: error })
        })
      },
    },
  },
  socialProviders,
  // Reset and verification tokens are stored as SHA-256 identifiers, so a
  // database read does not reveal a live link. Rows written before this option
  // stay usable: Better Auth also tries the plain identifier for them.
  verification: { storeIdentifier: 'hashed' },
  account: {
    accountLinking: {
      // An invited or bootstrapped account is never email-verified locally, so
      // linking has to rely on the provider vouching for the address instead.
      enabled: true,
      requireLocalEmailVerified: false,
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Every session, whatever the sign-in method (password, social, SSO).
        // Throwing here refuses the sign-in with ACCOUNT_BLOCKED.
        before: async (session) => {
          const [row] = await db
            .select({ blockedAt: schema.user.blockedAt })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1)
          // The lookup can come back empty, so the row check stays.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (row?.blockedAt) {
            throw new APIError('FORBIDDEN', {
              code: 'ACCOUNT_BLOCKED',
              message: m.server_account_blocked(),
            })
          }
        },
        // Every new session that comes from a sign-in endpoint. Session swaps
        // made by two-factor changes are not sign-ins and are not recorded.
        after: async (session, context) => {
          if (!SIGN_IN_PATH.test(context?.path ?? '')) return
          await auditAuthEvent({
            action: 'user.sign_in',
            userId: session.userId,
            sessionId: session.id,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
          })
        },
      },
    },
    user: {
      create: {
        before: async (created, ctx) => {
          await assertEmailMayRegister(created.email, {
            passwordSignup: ctx?.path === '/sign-up/email',
            emailVerified: created.emailVerified,
            invitationToken: ctx?.body?.invitationToken,
          })
        },
      },
      update: {
        before: async (data, ctx) => {
          if (typeof data.twoFactorEnabled !== 'boolean') return
          // Two-factor is only changed by the signed-in user, so the session
          // names the row. Without one, no notice is sent.
          const userId = ctx?.context.session?.user.id
          if (!userId) return
          const [row] = await db
            .select({ enabled: schema.user.twoFactorEnabled })
            .from(schema.user)
            .where(eq(schema.user.id, userId))
            .limit(1)
          // The lookup can come back empty, so the row check stays.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (row && row.enabled !== data.twoFactorEnabled) {
            pendingTwoFactorChanges.set(userId, data.twoFactorEnabled)
          }
        },
        after: async (updated) => {
          const enabled = pendingTwoFactorChanges.get(updated.id)
          if (enabled === undefined) return
          pendingTwoFactorChanges.delete(updated.id)
          if (updated.twoFactorEnabled !== enabled) return
          await auditAuthEvent({
            action: enabled
              ? 'user.two_factor_enable'
              : 'user.two_factor_disable',
            userId: updated.id,
          })
          await sendQuietly('two-factor email', () =>
            sendAccountEmail({
              kind: enabled ? 'two_factor_enabled' : 'two_factor_disabled',
              userId: updated.id,
              params: { userId: updated.id, at: new Date().toISOString() },
            }),
          )
        },
      },
    },
  },
  user: {
    additionalFields: {
      isAgencyAdmin: {
        type: 'boolean',
        defaultValue: false,
        input: false,
      },
      // Owned by the two-factor plugin; declared so the session type has it.
      twoFactorEnabled: {
        type: 'boolean',
        defaultValue: false,
        input: false,
      },
      // Language for account and notification emails. Set by the server, never
      // from the sign-up body.
      locale: {
        type: 'string',
        required: false,
        input: false,
      },
      // Read by requireUser: a blocked person is treated as signed out.
      blockedAt: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Checked before Better Auth looks the email up, so a refused sign-up
      // never reveals whether the address already has an account.
      if (ctx.path === '/sign-up/email') {
        const body = isRecord(ctx.body) ? ctx.body : {}
        await assertPasswordSignupMayProceed(body.email, body.invitationToken)
      }
      // Each MCP site and the agency connector are protected resources. Create
      // the row when the authorization request names one, so the plugin accepts it.
      if (ctx.path === '/oauth2/authorize') {
        const session = await getSessionFromCtx(ctx)
        if (session) await assertAuthAdminMfa(session)
        assertSingleMcpResource(ctx.query?.resource, true)
        for (const resource of resourceParams(ctx.query?.resource)) {
          await ensureMcpResource(resource)
        }
      }
      if (ctx.path === '/oauth2/token' && isRecord(ctx.body)) {
        assertSingleMcpResource(
          ctx.body.resource as string | string[] | undefined,
          false,
        )
        await validateMcpRefreshGrant(ctx.body, ctx)
      }
      // Clients register with the redirect forms they use (loopback http for
      // desktop and CLI apps). Normalise the metadata before the plugin
      // validates it. See server/mcp/oauth-registration.ts.
      if (ctx.path === '/oauth2/register' && isRecord(ctx.body)) {
        return { context: { body: normaliseRegistrationBody(ctx.body) } }
      }
      // SSO connections come from the environment only, so the plugin's
      // runtime provider management endpoints stay closed. Letting any signed
      // in user register an identity provider would let them mint sign-ins.
      if (SSO_MANAGEMENT_PATHS.has(ctx.path)) {
        throw new APIError('NOT_FOUND', {
          code: 'SSO_PROVIDER_MANAGEMENT_DISABLED',
          message: 'SSO providers are configured through the environment.',
        })
      }
      if (ctx.path === '/request-password-reset') {
        await assertMailRequestBudget(
          ctx,
          'password-reset',
          RESET_REQUEST_RULE,
          'PASSWORD_RESET_RATE_LIMITED',
          m.server_password_reset_rate_limited(),
        )
      }
      if (ctx.path === '/send-verification-email') {
        await assertMailRequestBudget(
          ctx,
          'verify-email',
          VERIFY_REQUEST_RULE,
          'VERIFICATION_RATE_LIMITED',
          m.server_verification_email_rate_limited(),
        )
      }
      if (ctx.path === '/sign-out') {
        const session = await getSessionFromCtx(ctx)
        if (session) {
          await auditAuthEvent({
            action: 'user.sign_out',
            userId: session.user.id,
            sessionId: session.session.id,
            request: ctx.request,
          })
        }
      }
      if (SESSION_REVOKE_PATHS.has(ctx.path)) {
        await auditSessionRevocation(ctx)
      }
      // Without a password there is nothing to confirm before changing
      // two-factor, so a recently created session stands in for it.
      if (TWO_FACTOR_MANAGEMENT_PATHS.has(ctx.path)) {
        const session = await getSessionFromCtx(ctx)
        if (session) {
          if (ctx.path === '/two-factor/get-totp-uri') {
            assertTotpUriAvailable(session.user.twoFactorEnabled)
          }
          if (session.user.twoFactorEnabled) await assertAuthAdminMfa(session)
          const credential =
            await ctx.context.internalAdapter.findCredentialAccount(
              session.user.id,
            )
          assertPasswordlessFresh({
            hasPassword: Boolean(credential?.password),
            sessionCreatedAt: session.session.createdAt,
          })
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/change-password') {
        // Runs after failures too, so only a real change is announced.
        const result: unknown = ctx.context.returned
        if (isAPIError(result) || !isRecord(result)) return
        if (!isRecord(result.user) || typeof result.user.id !== 'string') return
        const userId = result.user.id
        await auditAuthEvent({
          action: 'user.password_change',
          userId,
          sessionId: ctx.context.session?.session.id,
          request: ctx.request,
        })
        await sendQuietly('password changed email', () =>
          sendAccountEmail({
            kind: 'password_changed',
            userId,
            params: { userId, at: new Date().toISOString() },
          }),
        )
        return
      }
      if (ctx.path === '/two-factor/generate-backup-codes') {
        const session = ctx.context.session
        if (session && !isAPIError(ctx.context.returned)) {
          await auditAuthEvent({
            action: 'user.backup_codes_regenerate',
            userId: session.user.id,
            sessionId: session.session.id,
            request: ctx.request,
          })
        }
        return
      }
      if (
        ctx.path !== '/two-factor/verify-totp' &&
        ctx.path !== '/two-factor/verify-backup-code'
      )
        return
      const result: unknown = ctx.context.returned
      if (isRecord(result) && typeof result.token === 'string') {
        await recordLocalMfaForToken(
          ctx.context.newSession?.session.token ?? result.token,
        )
      }
    }),
  },
  plugins: [
    ...(microsoftSso
      ? [
          sso({
            // Entra ID is the identity source for the tenant, so its
            // verified-email claim is what lets an SSO sign-in link to an
            // existing account.
            trustEmailVerified: true,
            defaultSSO: [microsoftSso],
          }),
        ]
      : []),
    // All agency-admin sessions, including SSO/social, must prove a local
    // TOTP or backup code before guards grant agency access.
    twoFactor({ issuer: 'Areca CMS', allowPasswordless: true }),
    // OAuth 2.1 authorization server for the per-site MCP endpoints. See
    // docs in server/mcp/oauth-resource.ts for the resource and scope model.
    oauthProvider({
      loginPage: '/login',
      consentPage: '/oauth/consent',
      scopes: [...MCP_OAUTH_SCOPES],
      grantTypes: ['authorization_code', 'refresh_token'],
      // Public (PKCE) clients register anonymously, as AI apps do.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Opaque access tokens: revocation takes effect at once, and the MCP
      // endpoint verifies them against the database on every request.
      disableJwtPlugin: true,
      accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: MCP_REFRESH_TOKEN_TTL_SECONDS,
      // Refresh tokens rotate on every use. A client that lost a refresh
      // response can retry the same request within this window and receive
      // the same tokens back. Presenting a rotated token after the window is
      // replay: the whole family is revoked and the user reconnects.
      refreshTokenReuseInterval: MCP_REFRESH_TOKEN_REUSE_SECONDS,
      prefix: {
        opaqueAccessToken: MCP_ACCESS_TOKEN_PREFIX,
        refreshToken: MCP_REFRESH_TOKEN_PREFIX,
      },
      // Every MCP resource is a site, so the plugin must not require explicit
      // client-to-resource links (those would be created per site by hand).
      enforcePerClientResources: false,
      customAccessTokenClaims: ({ referenceId }) => ({
        mcp_connection_id: referenceId,
      }),
      postLogin: {
        // Never redirects: the plugin only needs `consentReferenceId` here.
        page: '/oauth/consent',
        shouldRedirect: () => false,
        // Consent is remembered per (app, user, site), not per app, so an
        // approval for one site never covers another.
        consentReferenceId: async ({ user }) =>
          consentReferenceFor((await getOAuthProviderState())?.query, user.id),
      },
    }),
    tanstackStartCookies(),
  ],
})

// Keep token issuance/replay and connection revocation under the same grant lock.
export const auth: typeof authBase = {
  ...authBase,
  handler: (request) =>
    handleMcpOAuthTokenRequest(request, (incoming) =>
      handleLocalFactorRequest(incoming, authBase.handler, () =>
        authBase.api.getSession({ headers: incoming.headers }),
      ),
    ),
}
