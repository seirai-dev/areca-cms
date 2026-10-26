import * as React from 'react'
import {
  useMatches,
  useNavigate,
  useParams,
  useRouterState,
} from '@tanstack/react-router'

import { BrandMark } from '#/components/brand-mark'
import { AccountMenu, ShortcutsDialog } from '#/components/shell/account-menu'
import { CommandPalette } from '#/components/shell/command-palette'
import { MobileTabBar, MobileTopBar } from '#/components/shell/mobile-bars'
import { ShellContext } from '#/components/shell/shell-context'
import type { ShellMode, ShellValue } from '#/components/shell/shell-context'
import {
  ShortcutsProvider,
  TOGGLE_DETAILS_EVENT,
  focusPageSearch,
  useShortcut,
} from '#/components/shell/shortcuts'
import { DevBanner } from '#/components/shell/dev-banner'
import { Sidebar } from '#/components/shell/sidebar'
import {
  EmailVerifiedNotice,
  VerifyEmailBanner,
} from '#/features/account/verify-email-banner'
import { ActivityPanel } from '#/features/activity/activity-panel'
import { MailBanners } from '#/features/agency/mail-banners'
import { GoLivePanel } from '#/features/golive/golive-panel'
import { useIsMobile, useIsTablet } from '#/hooks/use-mobile'
import { isDevSite } from '#/lib/site-environment'
import { canManageSite, findSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'

const SIDEBAR_KEY = 'areca.sidebar'

/** Rail state for 768–1023px, remembered per browser. */
function useRailPreference() {
  const [collapsed, setCollapsed] = React.useState(true)
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_KEY)
      if (stored === 'expanded') setCollapsed(false)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  const toggle = React.useCallback(() => {
    setCollapsed((value) => {
      const next = !value
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded')
      } catch {
        /* localStorage unavailable */
      }
      return next
    })
  }, [])
  return [collapsed, toggle] as const
}

function useShellMode(): ShellMode {
  return useMatches({
    select: (matches) => {
      if (matches.some((match) => match.staticData.shell === 'focus')) {
        return 'focus'
      }
      if (matches.some((match) => match.staticData.shell === 'bare')) {
        return 'bare'
      }
      if (matches.some((match) => match.routeId.startsWith('/_app/agency'))) {
        return 'agency'
      }
      if (
        matches.some((match) => match.routeId.startsWith('/_app/sites/$siteId'))
      ) {
        return 'site'
      }
      return 'bare'
    },
  })
}

/** Shell-level shortcuts: ⌘K, ⌘., g o/l/p/s, n, / (brief §3.12). */
function GlobalShortcuts({ value }: { value: ShellValue }) {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const { mode, site, me } = value
  const inSite = mode !== 'agency' && site
  const inCollectionList =
    Boolean(params.collectionKey) && !params.entryId && mode === 'site'

  useShortcut('mod+k', () => value.setPaletteOpen(!value.paletteOpen))
  useShortcut('mod+.', () =>
    window.dispatchEvent(new Event(TOGGLE_DETAILS_EVENT)),
  )
  useShortcut('g s', () => value.setSwitcherOpen(true), {
    enabled: mode !== 'focus',
  })
  useShortcut('g o', () => {
    if (inSite)
      void navigate({ to: '/sites/$siteId', params: { siteId: inSite.id } })
    else if (mode === 'agency') void navigate({ to: '/agency' })
  })
  useShortcut(
    'g l',
    () =>
      void navigate({
        to: '/sites/$siteId/library',
        params: { siteId: inSite ? inSite.id : '' },
      }),
    { enabled: Boolean(inSite) },
  )
  useShortcut('g p', () => {
    if (inSite && canManageSite(me, inSite.organizationId)) {
      void navigate({
        to: '/sites/$siteId/people',
        params: { siteId: inSite.id },
      })
    } else if (mode === 'agency') {
      void navigate({ to: '/agency/people' })
    }
  })
  useShortcut(
    'n',
    () =>
      void navigate({
        to: '/sites/$siteId/c/$collectionKey/new',
        params: {
          siteId: params.siteId ?? '',
          collectionKey: params.collectionKey ?? '',
        },
      }),
    { enabled: inCollectionList },
  )
  useShortcut('/', () => {
    if (!focusPageSearch()) value.setPaletteOpen(true)
  })
  return null
}

/** Right slide-overs for the site workspace (`?panel=golive|activity`). */
function SitePanels({ me, siteId }: { me: Me; siteId: string }) {
  const site = findSite(me, siteId)
  if (!site) return null
  const manage = canManageSite(me, site.organizationId)
  return (
    <>
      {/* A development environment has no releases (Decision 7). */}
      {isDevSite(site) ? null : <GoLivePanel site={site} canPublish={manage} />}
      {manage ? <ActivityPanel site={site} /> : null}
    </>
  )
}

/**
 * The app frame (brief §2.1): desktop sidebar (264px; a remembered 64px rail
 * between 768 and 1023px), the mobile top bar and tab bar below 768px, and
 * the page column. Editor routes (`staticData.shell = 'focus'`) render with
 * no sidebar; the `/sites` picker (`'bare'`) with a slim top bar.
 */
export function AppShell({
  me,
  children,
}: {
  me: Me
  children: React.ReactNode
}) {
  const mode = useShellMode()
  const params = useParams({ strict: false })
  const site = findSite(me, params.siteId)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const mobile = useIsMobile()
  const tablet = useIsTablet()
  const [railCollapsed, toggleRail] = useRailPreference()

  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [switcherOpen, setSwitcherOpen] = React.useState(false)

  React.useEffect(() => {
    setSwitcherOpen(false)
  }, [pathname])

  const value = React.useMemo<ShellValue>(
    () => ({
      me,
      mode,
      site,
      paletteOpen,
      setPaletteOpen,
      shortcutsOpen,
      setShortcutsOpen,
      switcherOpen,
      setSwitcherOpen,
    }),
    [me, mode, site, paletteOpen, shortcutsOpen, switcherOpen],
  )

  const withSidebar = mode === 'site' || mode === 'agency'
  const collapsed = tablet && railCollapsed
  const sidebarOffset =
    !withSidebar || mobile
      ? '0px'
      : collapsed
        ? 'var(--sidebar-rail-width)'
        : 'var(--sidebar-width)'

  return (
    <ShellContext.Provider value={value}>
      <ShortcutsProvider>
        <GlobalShortcuts value={value} />
        <div
          data-shell-mode={mode}
          className="min-h-dvh bg-background-default"
          style={
            {
              '--shell-sidebar-offset': sidebarOffset,
              '--mobile-tabbar-h': withSidebar && mobile ? '56px' : '0px',
              // Focus mode has no top bar at any width.
              ...(mode === 'focus' ? { '--navbar-height': '0px' } : {}),
            } as React.CSSProperties
          }
        >
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-above-overlay focus:rounded-control focus:bg-background-elevated focus:px-3 focus:py-2 focus:text-[14px] focus:font-medium focus:shadow-float focus:outline-2 focus:outline-border-focus"
          >
            {m.shell_skip_to_content()}
          </a>

          {withSidebar ? (
            <>
              <Sidebar
                collapsed={collapsed}
                canCollapse={tablet}
                onToggleCollapsed={toggleRail}
              />
              <MobileTopBar />
            </>
          ) : mode === 'bare' ? (
            <header className="sticky top-0 z-navbar flex h-14 items-center gap-3 border-b border-border-default bg-background-default/85 px-4 backdrop-blur-xl md:px-8">
              <BrandMark size="sm" />
              <div className="ml-auto">
                <AccountMenu variant="avatar" />
              </div>
            </header>
          ) : null}

          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              'min-w-0 outline-none',
              'md:pl-(--shell-sidebar-offset) md:transition-[padding] md:duration-200 md:ease-(--ease-standard)',
              withSidebar &&
                'pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom))]',
            )}
          >
            <div
              // A fresh page tree per path, but never remount the editor.
              key={mode === 'focus' ? 'focus' : pathname}
              className={cn(
                'mx-auto w-full min-w-0',
                mode === 'focus'
                  ? 'max-w-[1440px] px-6 py-6'
                  : 'max-w-(--content-max) px-4 pt-6 pb-16 md:px-8 md:pt-10',
              )}
            >
              {mode !== 'focus' ? <VerifyEmailBanner me={me} /> : null}
              {me.user.isAgencyAdmin && mode !== 'focus' ? (
                <MailBanners />
              ) : null}
              {site && isDevSite(site) && mode !== 'focus' ? (
                <DevBanner me={me} site={site} />
              ) : null}
              {children}
            </div>
          </main>

          {withSidebar ? <MobileTabBar /> : null}
          {params.siteId ? <SitePanels me={me} siteId={params.siteId} /> : null}
          <CommandPalette />
          <ShortcutsDialog />
          <EmailVerifiedNotice />
        </div>
      </ShortcutsProvider>
    </ShellContext.Provider>
  )
}
