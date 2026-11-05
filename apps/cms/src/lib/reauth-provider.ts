import type { AuthMethods, SocialProviderId } from '#/lib/auth-providers'

/** How a provider-only account signs in again to prove it is still them. */
export type ReauthProvider =
  | { kind: 'social'; provider: SocialProviderId }
  | { kind: 'sso'; providerId: string }

/**
 * The provider a passwordless account should sign in again with: one the
 * account is linked to and the environment still has switched on. SSO wins
 * over social providers; null when none of the linked providers is enabled.
 */
export function reauthProviderFor(
  linkedProviderIds: ReadonlyArray<string>,
  methods: AuthMethods,
): ReauthProvider | null {
  if (methods.sso && linkedProviderIds.includes(methods.sso.providerId)) {
    return { kind: 'sso', providerId: methods.sso.providerId }
  }
  const social = methods.socials.find((id) => linkedProviderIds.includes(id))
  return social ? { kind: 'social', provider: social } : null
}
