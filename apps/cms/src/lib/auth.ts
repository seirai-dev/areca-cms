import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
import * as schema from '#/db/schema'
import { env } from '#/env'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [
    new URL(env.BETTER_AUTH_URL).origin,
    new URL(env.APP_URL).origin,
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:3000', 'http://127.0.0.1:3000']),
  ],
  emailAndPassword: {
    enabled: true,
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
  plugins: [tanstackStartCookies()],
})
