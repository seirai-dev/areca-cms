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
} from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
import * as schema from '#/db/schema'
import { env } from '#/env'
import { assertEmailMayRegister } from '#/server/auth/registration-gate'
import {
  MCP_ACCESS_TOKEN_PREFIX,
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_OAUTH_SCOPES,
  MCP_REFRESH_TOKEN_PREFIX,
  MCP_REFRESH_TOKEN_REUSE_SECONDS,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  ensureMcpSiteResource,
  resourceParams,
  siteIdForAuthorizationQuery,
} from '#/server/mcp/oauth-resource'
import { normaliseRegistrationBody } from '#/server/mcp/oauth-registration'
import {
  TWO_FACTOR_MANAGEMENT_PATHS,
  assertPasswordlessFresh,
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

const SSO_MANAGEMENT_PATHS = new Set([
  '/sso/register',
  '/sso/update-provider',
  '/sso/delete-provider',
  '/sso/request-domain-verification',
  '/sso/verify-domain',
])

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
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
  },
  socialProviders,
  account: {
    accountLinking: {
      // An invited or bootstrapped account is never email-verified locally, so
      // linking has to rely on the provider vouching for the address instead.
      enabled: true,
      requireLocalEmailVerified: false,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (created) => {
          await assertEmailMayRegister(created.email)
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
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Each MCP site is its own protected resource. Create its row when the
      // authorization request names it, so the plugin accepts the resource.
      if (ctx.path === '/oauth2/authorize') {
        for (const resource of resourceParams(ctx.query?.resource)) {
          await ensureMcpSiteResource(resource)
        }
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
      // Without a password there is nothing to confirm before changing
      // two-factor, so a recently created session stands in for it.
      if (TWO_FACTOR_MANAGEMENT_PATHS.has(ctx.path)) {
        const session = await getSessionFromCtx(ctx)
        if (session) {
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
    // TOTP + backup codes. Enforcement for agency admins lives in
    // `requireAgencyAdmin`; SSO/social sign-ins skip the challenge because the
    // identity provider is trusted to have done its own MFA.
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
      postLogin: {
        // Never redirects: the plugin only needs `consentReferenceId` here.
        page: '/oauth/consent',
        shouldRedirect: () => false,
        // Consent is remembered per (app, user, site), not per app, so an
        // approval for one site never covers another.
        consentReferenceId: async () =>
          siteIdForAuthorizationQuery((await getOAuthProviderState())?.query),
      },
    }),
    tanstackStartCookies(),
  ],
})
