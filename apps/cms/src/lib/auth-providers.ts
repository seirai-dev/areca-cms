import { env } from '#/env'

/**
 * Sign-in methods are configured entirely through the environment:
 *
 * - email/password is on unless `AUTH_EMAIL_PASSWORD_ENABLED=false`
 * - a social provider is on when both of its credentials are set
 * - Microsoft SSO is on when its client id and secret are set
 *
 * A provider that is off is never registered with Better Auth, so it cannot be
 * used to sign in even if someone hand-crafts the request, and it is never
 * listed for the sign-in page.
 */
export const SOCIAL_PROVIDER_IDS = ['github', 'google', 'discord'] as const

export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]

/** Provider id used for the Microsoft Entra ID connection registered via SSO. */
export const MICROSOFT_SSO_PROVIDER_ID = 'microsoft'

export type AuthMethods = {
  emailPassword: boolean
  socials: Array<SocialProviderId>
  sso: { providerId: string } | null
}

export const emailPasswordEnabled = env.AUTH_EMAIL_PASSWORD_ENABLED

function credentials(id?: string, secret?: string) {
  return id && secret ? { clientId: id, clientSecret: secret } : undefined
}

/**
 * Only the providers with credentials end up here, which is exactly what
 * `betterAuth({ socialProviders })` should receive.
 */
export const socialProviders = Object.fromEntries(
  Object.entries({
    github: credentials(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    google: credentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    discord: credentials(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
  }).filter(([, value]) => value !== undefined),
) as Partial<
  Record<SocialProviderId, { clientId: string; clientSecret: string }>
>

const microsoftCredentials = env.MICROSOFT_SSO_TENANT_ID
  ? credentials(env.MICROSOFT_SSO_CLIENT_ID, env.MICROSOFT_SSO_CLIENT_SECRET)
  : undefined

const microsoftIssuer = `https://login.microsoftonline.com/${env.MICROSOFT_SSO_TENANT_ID}/v2.0`

/**
 * Registered through the SSO plugin's `defaultSSO`, which takes precedence over
 * database-stored providers. That keeps the Microsoft connection a pure .env
 * concern: no provider rows to seed, migrate, or keep in sync.
 */
export const microsoftSso = microsoftCredentials
  ? {
      providerId: MICROSOFT_SSO_PROVIDER_ID,
      domain: env.MICROSOFT_SSO_DOMAIN ?? '',
      oidcConfig: {
        issuer: microsoftIssuer,
        discoveryEndpoint: `${microsoftIssuer}/.well-known/openid-configuration`,
        clientId: microsoftCredentials.clientId,
        clientSecret: microsoftCredentials.clientSecret,
        pkce: true,
        scopes: ['openid', 'profile', 'email'],
        // Entra ID only emits the `email` claim when the account has a mail
        // attribute, so directory users must have one to sign in here.
        mapping: {
          email: 'email',
          emailVerified: 'email_verified',
          name: 'name',
        },
      },
    }
  : null

/**
 * The SSO plugin refuses to fetch OIDC metadata from an origin that is not
 * trusted, so Entra ID's endpoints have to be allowed explicitly: the login
 * host serves discovery, authorization, token and JWKS; Graph serves userinfo.
 */
export const microsoftSsoTrustedOrigins = microsoftSso
  ? ['https://login.microsoftonline.com', 'https://graph.microsoft.com']
  : []

export function enabledAuthMethods(): AuthMethods {
  return {
    emailPassword: emailPasswordEnabled,
    socials: SOCIAL_PROVIDER_IDS.filter((id) => id in socialProviders),
    sso: microsoftSso ? { providerId: microsoftSso.providerId } : null,
  }
}
