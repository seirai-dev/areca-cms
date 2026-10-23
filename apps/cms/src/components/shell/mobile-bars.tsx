import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import type { LinkOptions } from '@tanstack/react-router'
import {
  DotsThreeCircle,
  MagnifyingGlass,
  Notebook,
  Pulse,
  RocketLaunch,
  Stack,
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
import { QueryError } from '#/components/ui/query-error'
import { Tag } from '#/components/ui/tag'
import { GoLivePill } from '#/features/golive/golive-tray'
import {
  GLOBAL_ROUTE,
  siteContentNavItems,
} from '#/features/globals/site-content'
import { useSiteGlobals } from '#/features/globals/use-globals'
import { usePanel } from '#/features/shell/panel'
import {
  agencyNavItems,
  canManageSite,
  collectionIcon,
  siteNavItems,
} from '#/lib/site-nav'
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
    const [overview, library, ...moreItems] = siteNavItems(me, site)
    return (
      <>
        <nav
          aria-label={m.shell_site_navigation()}
          data-testid="mobile-tab-bar"
          className="fixed inset-x-0 bottom-0 z-navbar flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-border-default bg-background-default/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 md:hidden"
        >
          <TabLink
            link={{ to: overview.to, params: { siteId: site.id } }}
            icon={overview.icon}
            label={overview.label}
            exact={overview.exact}
          />
          <TabButton
            icon={Stack}
            label={m.shell_nav_content()}
            active={inContent || sheet === 'content'}
            onClick={() => setSheet('content')}
            testId="mobile-content"
          />
          <TabLink
            link={{ to: library.to, params: { siteId: site.id } }}
            icon={library.icon}
            label={library.label}
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
              <MobileSiteContent siteId={site.id} onNavigate={close} />
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
                {moreItems.map((item) => (
                  <SheetRowLink
                    key={item.key}
                    link={{ to: item.to, params: { siteId: site.id } }}
                    icon={<item.icon />}
                    label={item.label}
                    onClick={close}
                  />
                ))}
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
    const [overview, clients, people, ...moreItems] = agencyNavItems()
    return (
      <>
        <nav
          aria-label={m.shell_agency_navigation()}
          data-testid="mobile-tab-bar"
          className="fixed inset-x-0 bottom-0 z-navbar flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-border-default bg-background-default/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 md:hidden"
        >
          <TabLink
            link={{ to: overview.to }}
            icon={overview.icon}
            label={overview.label}
            exact={overview.exact}
          />
          <TabLink
            link={{ to: clients.to }}
            icon={clients.icon}
            label={clients.label}
          />
          <TabLink
            link={{ to: people.to }}
            icon={people.icon}
            label={people.label}
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
            <SheetBody className="grid auto-rows-max grid-cols-1 content-start gap-5 pt-0">
              <InsetList>
                {moreItems.map((item) => (
                  <SheetRowLink
                    key={item.key}
                    link={{ to: item.to }}
                    icon={<item.icon />}
                    label={item.label}
                    onClick={close}
                  />
                ))}
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

/** Site content sections in the mobile Content sheet (same rules as the sidebar group). */
function MobileSiteContent({
  siteId,
  onNavigate,
}: {
  siteId: string
  onNavigate: () => void
}) {
  const { me } = useShell()
  const isAgency = me.user.isAgencyAdmin
  const query = useSiteGlobals(siteId)
  const items = siteContentNavItems(query.data ?? [], {
    isAgencyAdmin: isAgency,
  })
  if (items.length === 0) return null
  return (
    <div className="mt-6 grid gap-2" data-testid="site-content-group-mobile">
      <p className="px-1 text-callout text-text-secondary">
        {m.globals_nav_group()}
      </p>
      <InsetList>
        {items.map((item) => (
          <SheetRowLink
            key={item.key}
            link={{
              to: GLOBAL_ROUTE,
              params: { siteId, globalKey: item.key },
            }}
            icon={<Notebook />}
            tone={item.enabled ? 'accent' : 'neutral'}
            label={item.label}
            onClick={onNavigate}
            trailing={
              item.enabled ? null : (
                <Tag tone="outline">{m.shell_collection_off()}</Tag>
              )
            }
          />
        ))}
      </InsetList>
    </div>
  )
}

function MobileCollections({
  siteId,
  onNavigate,
}: {
  siteId: string
  onNavigate: () => void
}) {
  const { me } = useShell()
  const {
    collections,
    counts,
    isLoading,
    isError,
    error,
    isRetrying,
    refetch,
  } = useSiteCollections(siteId, me.user.isAgencyAdmin)
  if (isLoading) return null
  if (isError) {
    return <QueryError error={error} onRetry={refetch} retrying={isRetrying} />
  }
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
