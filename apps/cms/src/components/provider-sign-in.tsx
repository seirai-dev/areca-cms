import { useState } from 'react'
import type { ReactElement, SVGProps } from 'react'

import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'
import type { AuthMethods, SocialProviderId } from '#/lib/auth-providers'
import { m } from '#/paraglide/messages'

function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}

function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.61v3h3.86c2.26-2.08 3.58-5.15 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3a7.2 7.2 0 0 1-10.73-3.79H1.34v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.34 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.34a12 12 0 0 0 0 10.79l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.34 6.6l4 3.1A7.2 7.2 0 0 1 12 4.75Z"
      />
    </svg>
  )
}

function DiscordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.32 4.58A19.8 19.8 0 0 0 15.44 3l-.24.45c1.6.4 2.98 1.07 4.24 1.99A15.9 15.9 0 0 0 12 4.04c-2.61 0-5.06.5-7.44 1.4A13.7 13.7 0 0 1 8.8 3.45L8.56 3A19.8 19.8 0 0 0 3.68 4.58C.94 8.7.2 12.72.57 16.68a19.9 19.9 0 0 0 6.03 3.05l.73-1.2a13 13 0 0 1-2.06-.99l.5-.4a14.2 14.2 0 0 0 12.46 0l.5.4c-.65.39-1.34.72-2.06.99l.73 1.2a19.9 19.9 0 0 0 6.03-3.05c.44-4.59-.74-8.58-2.11-12.1ZM8.35 14.53c-1.18 0-2.15-1.09-2.15-2.42s.95-2.43 2.15-2.43c1.21 0 2.18 1.1 2.16 2.43 0 1.33-.95 2.42-2.16 2.42Zm7.3 0c-1.18 0-2.15-1.09-2.15-2.42s.95-2.43 2.15-2.43c1.21 0 2.18 1.1 2.16 2.43 0 1.33-.95 2.42-2.16 2.42Z" />
    </svg>
  )
}

function MicrosoftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="#F25022" d="M2 2h9.5v9.5H2Z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5Z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2Z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5Z" />
    </svg>
  )
}

const SOCIALS = {
  github: { icon: GitHubIcon, label: () => m.auth_continue_with_github() },
  google: { icon: GoogleIcon, label: () => m.auth_continue_with_google() },
  discord: { icon: DiscordIcon, label: () => m.auth_continue_with_discord() },
} satisfies Record<
  SocialProviderId,
  {
    icon: (props: SVGProps<SVGSVGElement>) => ReactElement
    label: () => string
  }
>

/**
 * Renders a button per sign-in provider the server reported as enabled. A
 * provider that is off in the environment simply isn't in `methods`, so there
 * is nothing to click and nothing to hide.
 */
export function ProviderSignIn({
  methods,
  callbackURL,
  errorCallbackURL,
}: {
  methods: AuthMethods
  callbackURL: string
  errorCallbackURL: string
}) {
  const [pending, setPending] = useState<string | null>(null)
  const sso = methods.sso

  if (methods.socials.length === 0 && !sso) {
    return null
  }

  return (
    <div className="grid gap-2">
      {methods.socials.map((provider) => {
        const { icon: Icon, label } = SOCIALS[provider]
        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            disabled={pending !== null}
            data-testid={`sign-in-${provider}`}
            onClick={() => {
              setPending(provider)
              void authClient.signIn.social({
                provider,
                callbackURL,
                errorCallbackURL,
              })
            }}
          >
            <Icon />
            {label()}
          </Button>
        )
      })}
      {sso ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          data-testid="sign-in-sso"
          onClick={() => {
            setPending('sso')
            void authClient.signIn.sso({
              providerId: sso.providerId,
              callbackURL,
              errorCallbackURL,
            })
          }}
        >
          <MicrosoftIcon />
          {m.auth_continue_with_microsoft()}
        </Button>
      ) : null}
    </div>
  )
}

/** Separates the provider buttons from the email/password form. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {m.auth_or()}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
