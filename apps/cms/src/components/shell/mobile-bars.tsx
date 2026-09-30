import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import type { LinkOptions } from '@tanstack/react-router'
import {
  Buildings,
  DotsThreeCircle,
  Gear,
  House,
  ImageSquare,
  MagnifyingGlass,
  Palette,
  Pulse,
  RocketLaunch,
  Stack,
  Users,
  UsersThree,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

import { AccountMenu } from '#/components/shell/account-menu'
import { useShell } from '#/components/shell/shell-context'
import {
  AllSitesNav,
  WorkspaceSwitcher,
} from '#/components/shell/workspace-switcher'
import { useSiteCollections } from '#/components/shell/sidebar'
import { NavCount } from '#/components/shell/nav-item'
import { InsetIcon, InsetList, InsetRow } from '#/components/ui/inset-list'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { Tag } from '#/components/ui/tag'
import { GoLivePill } from '#/features/golive/golive-tray'
import { usePanel } from '#/features/shell/panel'
import { canManageSite, collectionIcon } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * Mobile shell (< 768px, brief §2.1): a top bar (compact workspace card, the
 * Go‑live pill, search, account avatar) and a bottom tab bar
 * (Overview · Content · Library · More). Content and More open sheets.
 */
export function MobileTopBar() {
  const { mode, site, setPaletteOpen } = useShell()
  return (
    <header
      data-testid="mobile-top-bar"
      className="sticky top-0 z-navbar flex h-(--navbar-height) items-center gap-1 border-b border-border-default bg-background-default/85 px-2 backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <div className="min-w-0 flex-1">
        <WorkspaceSwitcher compact testId="sites-nav-mobile" />
      </div>
      {mode === 'site' && site ? <GoLivePill siteId={site.id} /> : null}
      <button
        type="button"
        aria-label={m.shell_search()}
        data-testid="open-search-mobile"
        onClick={() => setPaletteOpen(true)}
        className="grid size-10 shrink-0 place-content-center rounded-full text-icon-default outline-none active:bg-surface-state-pressed focus-visible:outline-2 focus-visible:outline-border-focus"
      >
        <MagnifyingGlass size={20} />
      </button>
      <AccountMenu variant="avatar" testId="user-menu-mobile" />
    </header>
  )
}

function TabLink({
  link,
  icon: IconComponent,
  label,
  exact,
}: {
  link: LinkOptions
  icon: Icon
  label: string
  exact?: boolean
}) {
  return (
    <Link
      {...link}
      activeOptions={{ exact, includeSearch: false }}
      className="group/tab flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-text-muted outline-none data-[status=active]:text-text-accent focus-visible:bg-surface-state-hover"
    >
      {({ isActive }) => (
        <>
          <IconComponent size={24} weight={isActive ? 'fill' : 'regular'} />
          <span>{label}</span>
        </>
      )}
    </Link>
  )
}

function TabButton({
  icon: IconComponent,
  label,
  active,
  onClick,
  testId,
}: {
  icon: Icon
  label: string
  active?: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-haspopup="dialog"
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium outline-none focus-visible:bg-surface-state-hover',
        active ? 'text-text-accent' : 'text-text-muted',
      )}
    >
      <IconComponent size={24} weight={active ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>
  )
}

function SheetRowLink({
  link,
  icon,
  label,
  trailing,
  onClick,
  tone = 'neutral',
}: {
  link: LinkOptions
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
  onClick: () => void
  tone?: 'neutral' | 'accent'
}) {
  return (
    <InsetRow
      asChild
      chevron
      leading={<InsetIcon tone={tone}>{icon}</InsetIcon>}
      title={label}
      trailing={trailing}
    >
      <Link {...link} onClick={onClick} />
    </InsetRow>
  )
}

export function MobileTabBar() {
  const { me, mode, site } = useShell()
  const panel = usePanel()
  const [sheet, setSheet] = React.useState<'content' | 'more' | null>(null)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const close = () => setSheet(null)

  React.useEffect(() => setSheet(null), [pathname])

  if (mode === 'site' && site) {
    const inContent = pathname.startsWith(`/sites/${site.id}/c/`)
    const manage = canManageSite(me, site.organizationId)
    return (
      <>
        <nav
          aria-label={m.shell_site_navigation()}
          data-testid="mobile-tab-bar"
          className="fixed inset-x-0 bottom-0 z-navbar flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-border-default bg-background-default/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 md:hidden"
        >
          <TabLink
            link={{ to: '/sites/$siteId', params: { siteId: site.id } }}
            icon={House}
            label={m.shell_nav_overview()}
            exact
          />
          <TabButton
            icon={Stack}
            label={m.shell_nav_content()}
            active={inContent || sheet === 'content'}
            onClick={() => setSheet('content')}
            testId="mobile-content"
          />
          <TabLink
            link={{ to: '/sites/$siteId/library', params: { siteId: site.id } }}
            icon={ImageSquare}
            label={m.shell_nav_library()}
          />
          <TabButton
            icon={DotsThreeCircle}
            label={m.shell_more()}
            active={sheet === 'more'}
            onClick={() => setSheet('more')}
            testId="mobile-more"
          />
        </nav>

        <Sheet
          open={sheet === 'content'}
          onOpenChange={(open) => !open && close()}
        >
          <SheetContent side="bottom" className="max-h-[80dvh]">
            <SheetHeader className="border-b-0 pb-2">
              <SheetTitle>{m.shell_nav_content()}</SheetTitle>
            </SheetHeader>
            <SheetBody className="pt-0">
              <MobileCollections siteId={site.id} onNavigate={close} />
            </SheetBody>
          </SheetContent>
        </Sheet>

        <Sheet
          open={sheet === 'more'}
          onOpenChange={(open) => !open && close()}
        >
          <SheetContent side="bottom">
            <SheetHeader className="border-b-0 pb-2">
              <SheetTitle>{m.shell_more()}</SheetTitle>
            </SheetHeader>
            <SheetBody className="pt-0">
              <InsetList>
                {manage ? (
                  <SheetRowLink
                    link={{
                      to: '/sites/$siteId/people',
                      params: { siteId: site.id },
                    }}
                    icon={<Users />}
                    label={m.shell_nav_people()}
                    onClick={close}
                  />
                ) : null}
                {me.user.isAgencyAdmin ? (
                  <SheetRowLink
                    link={{
                      to: '/sites/$siteId/settings',
                      params: { siteId: site.id },
                    }}
                    icon={<Gear />}
                    label={m.shell_nav_settings()}
                    onClick={close}
                  />
                ) : null}
                {manage ? (
                  <InsetRow
                    asChild
                    chevron
                    leading={
                      <InsetIcon>
                        <Pulse />
                      </InsetIcon>
                    }
                    title={m.shell_nav_activity()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        close()
                        panel.open('activity')
                      }}
                    />
                  </InsetRow>
                ) : null}
                <InsetRow
                  asChild
                  chevron
                  leading={
                    <InsetIcon tone="accent">
                      <RocketLaunch weight="fill" />
                    </InsetIcon>
                  }
                  title={m.golive_go_live()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      close()
                      panel.open('golive')
                    }}
                  />
                </InsetRow>
              </InsetList>
            </SheetBody>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  if (mode === 'agency') {
    return (
      <>
        <nav
          aria-label={m.shell_agency_navigation()}
          data-testid="mobile-tab-bar"
          className="fixed inset-x-0 bottom-0 z-navbar flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-border-default bg-background-default/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 md:hidden"
        >
          <TabLink
            link={{ to: '/agency' }}
            icon={House}
            label={m.shell_nav_overview()}
            exact
          />
          <TabLink
            link={{ to: '/agency/clients' }}
            icon={Buildings}
            label={m.shell_nav_clients()}
          />
          <TabLink
            link={{ to: '/agency/people' }}
            icon={UsersThree}
            label={m.shell_nav_people()}
          />
          <TabButton
            icon={DotsThreeCircle}
            label={m.shell_more()}
            active={sheet === 'more'}
            onClick={() => setSheet('more')}
            testId="mobile-more"
          />
        </nav>
        <Sheet
          open={sheet === 'more'}
          onOpenChange={(open) => !open && close()}
        >
          <SheetContent side="bottom" className="max-h-[85dvh]">
            <SheetHeader className="border-b-0 pb-2">
              <SheetTitle>{m.shell_more()}</SheetTitle>
            </SheetHeader>
            <SheetBody className="grid gap-5 pt-0">
              <InsetList>
                <SheetRowLink
                  link={{ to: '/agency/activity' }}
                  icon={<Pulse />}
                  label={m.shell_nav_activity()}
                  onClick={close}
                />
                <SheetRowLink
                  link={{ to: '/agency/branding' }}
                  icon={<Palette />}
                  label={m.shell_nav_branding()}
                  onClick={close}
                />
              </InsetList>
              <div className="grid gap-1">
                <span className="px-1 text-overline text-text-muted">
                  {m.shell_nav_all_sites()}
                </span>
                <AllSitesNav collapsed={false} onNavigate={close} />
              </div>
            </SheetBody>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return null
}

function MobileCollections({
  siteId,
  onNavigate,
}: {
  siteId: string
  onNavigate: () => void
}) {
  const { me } = useShell()
  const { collections, counts, isLoading } = useSiteCollections(
    siteId,
    me.user.isAgencyAdmin,
  )
  if (isLoading) return null
  if (collections.length === 0) {
    return (
      <p className="py-6 text-center text-callout text-text-secondary">
        {m.shell_no_content_types()}
      </p>
    )
  }
  return (
    <InsetList>
      {collections.map((collection, index) => {
        const IconComponent = collectionIcon(collection.key, collection.label)
        return (
          <SheetRowLink
            key={collection.id}
            link={{
              to: '/sites/$siteId/c/$collectionKey',
              params: { siteId, collectionKey: collection.key },
            }}
            icon={<IconComponent />}
            tone={collection.enabled ? 'accent' : 'neutral'}
            label={collection.label}
            onClick={onNavigate}
            trailing={
              collection.enabled ? (
                <NavCount value={counts[index]} />
              ) : (
                <Tag tone="outline">{m.shell_collection_off()}</Tag>
              )
            }
          />
        )
      })}
    </InsetList>
  )
}
