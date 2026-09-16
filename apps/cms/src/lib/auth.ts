import { sso } from '@better-auth/sso'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
import * as schema from '#/db/schema'
import { env } from '#/env'
import { assertEmailMayRegister } from '#/server/auth/registration-gate'

import {
  emailPasswordEnabled,
  microsoftSso,
  microsoftSsoTrustedOrigins,
  socialProviders,
} from './auth-providers.ts'

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
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // SSO connections come from the environment only, so the plugin's
      // runtime provider management endpoints stay closed. Letting any signed
      // in user register an identity provider would let them mint sign-ins.
      if (SSO_MANAGEMENT_PATHS.has(ctx.path)) {
        throw new APIError('NOT_FOUND', {
          code: 'SSO_PROVIDER_MANAGEMENT_DISABLED',
          message: 'SSO providers are configured through the environment.',
        })
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
    tanstackStartCookies(),
  ],
})
