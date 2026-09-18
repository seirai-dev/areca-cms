import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { BrandMark } from '#/components/brand-mark'
import { CommandPaletteTrigger } from '#/components/command-palette'
import { LanguageSwitcher } from '#/components/language-switcher'
import { SiteSwitcher } from '#/components/site-switcher'
import { ThemeToggle } from '#/components/theme'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useIsCompact } from '#/hooks/use-mobile'
import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale, locales, localizeHref, setLocale } from '#/paraglide/runtime'
import type { Me } from '#/server/fn/me'
import {
  Buildings,
  Check,
  Monitor,
  Moon,
  SignOut,
  Sun,
} from '@phosphor-icons/react'
import { useTheme } from 'next-themes'

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  nl: 'Nederlands',
  tr: 'Türkçe',
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'U'
  )
}

/** True once the page has been scrolled; drives the navbar hairline. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return scrolled
}

function UserMenu({ me, compact }: { me: Me; compact: boolean }) {
  const [ready, setReady] = useState(false)
  const { setTheme } = useTheme()
  const locale = getLocale()

  useEffect(() => setReady(true), [])

  async function signOut() {
    try {
      await authClient.signOut()
    } finally {
      window.location.assign(localizeHref('/login'))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={me.user.name}
          data-testid="user-menu"
          className="rounded-full"
        >
          <Avatar className="size-7">
            <AvatarFallback className="text-ds-label-sm">
              {initials(me.user.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate text-ds-label-md">{me.user.name}</span>
          <span className="truncate text-ds-body-xs font-normal text-text-muted">
            {me.user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {compact && me.user.isAgencyAdmin ? (
          <DropdownMenuItem asChild>
            <Link to="/admin/organizations" data-testid="agency-nav">
              <Buildings />
              {m.shell_nav_agency()}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun />
            {m.shell_theme()}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setTheme('light')}>
              <Sun />
              {m.shell_theme_light()}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('dark')}>
              <Moon />
              {m.shell_theme_dark()}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('system')}>
              <Monitor />
              {m.shell_theme_system()}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{m.shell_language()}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {locales.map((code) => (
              <DropdownMenuItem key={code} onSelect={() => setLocale(code)}>
                {LOCALE_LABELS[code] ?? code}
                {code === locale ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="sign-out"
          disabled={!ready}
          onSelect={() => void signOut()}
        >
          <SignOut />
          {m.shell_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The single horizontal bar of the app: brand, site switcher, and the right
 * cluster (Agency, search, theme, language, user). 58px, sticky, blurred; the
 * hairline only appears once the page is scrolled.
 */
export function Navbar({ me }: { me: Me }) {
  const compact = useIsCompact()
  const scrolled = useScrolled()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const agencyActive = pathname.startsWith('/admin')

  return (
    <header
      data-testid="navbar"
      className={cn(
        'sticky top-0 z-navbar h-(--navbar-height) border-b bg-background-default/90 backdrop-blur',
        scrolled ? 'border-border-subtle' : 'border-transparent',
      )}
    >
      <div className="mx-auto flex h-full w-full max-w-[100rem] items-center gap-2 px-4 sm:px-6">
        <Link to="/" data-testid="dashboard-nav" className="min-w-0 shrink-0">
          <BrandMark nameClassName="text-ds-heading-5" />
        </Link>
        <span
          aria-hidden="true"
          className="h-5 w-px shrink-0 bg-border-subtle"
        />
        <SiteSwitcher me={me} />

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {me.user.isAgencyAdmin && !compact ? (
            <Link
              to="/admin/organizations"
              data-testid="agency-nav"
              aria-current={agencyActive ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-control px-2.5 text-ds-label-md transition-colors',
                agencyActive
                  ? 'bg-surface-state-hover text-text-primary'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              <Buildings />
              {m.shell_nav_agency()}
            </Link>
          ) : null}
          <CommandPaletteTrigger />
          {compact ? null : (
            <>
              <ThemeToggle />
              <LanguageSwitcher compact />
            </>
          )}
          <UserMenu me={me} compact={compact} />
        </div>
      </div>
    </header>
  )
}
