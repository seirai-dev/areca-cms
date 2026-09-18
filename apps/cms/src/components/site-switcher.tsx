import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { EntityIcon } from '#/components/entity-icon'
import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import { useIsCompact } from '#/hooks/use-mobile'
import { findSite, groupSitesByOrg, siteIdFromPath } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import type { Me } from '#/server/fn/me'
import { CaretUpDown, Globe, Plus, SquaresFour } from '@phosphor-icons/react'

const RECENT_KEY = 'areca.recentSites'
const RECENT_MAX = 5

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

/** Push a site to the front of the recent list (used by the site frame). */
export function rememberRecentSite(siteId: string) {
  try {
    const next = [siteId, ...readRecent().filter((id) => id !== siteId)].slice(
      0,
      RECENT_MAX,
    )
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* localStorage unavailable */
  }
}

function SiteRow({
  site,
  onNavigate,
  current,
}: {
  site: MeSite
  onNavigate: () => void
  current: boolean
}) {
  return (
    <CommandItem
      value={`${site.name} ${site.slug} ${site.organizationName}`}
      onSelect={onNavigate}
      className="p-0"
    >
      <Link
        to="/sites/$siteId"
        params={{ siteId: site.id }}
        onClick={onNavigate}
        aria-current={current ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
      >
        <EntityIcon icon={Globe} size="sm" tone={current ? 'brand' : 'muted'} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-ds-label-md">{site.name}</span>
          <span className="hidden truncate text-ds-mono-xs text-text-muted sm:block">
            {site.slug}
          </span>
        </span>
      </Link>
    </CommandItem>
  )
}

function SwitcherList({
  me,
  currentSiteId,
  onNavigate,
}: {
  me: Me
  currentSiteId: string | undefined
  onNavigate: () => void
}) {
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => setRecent(readRecent()), [])

  const recentSites = recent
    .map((id) => me.sites.find((site) => site.id === id))
    .filter((site): site is MeSite => Boolean(site))
    .slice(0, 3)
  const groups = groupSitesByOrg(me.sites)

  return (
    <Command loop>
      <CommandInput placeholder={m.shell_switcher_search()} />
      <CommandList className="max-h-[22rem]">
        <CommandEmpty>{m.shell_switcher_empty()}</CommandEmpty>
        {recentSites.length > 1 ? (
          <CommandGroup heading={m.shell_switcher_recent()}>
            {recentSites.map((site) => (
              <SiteRow
                key={`recent-${site.id}`}
                site={site}
                current={site.id === currentSiteId}
                onNavigate={onNavigate}
              />
            ))}
          </CommandGroup>
        ) : null}
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.name}>
            {group.sites.map((site) => (
              <SiteRow
                key={site.id}
                site={site}
                current={site.id === currentSiteId}
                onNavigate={onNavigate}
              />
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup>
          <CommandItem value="all sites" onSelect={onNavigate} className="p-0">
            <Link
              to="/"
              onClick={onNavigate}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-ds-label-md"
            >
              <SquaresFour />
              {m.shell_nav_all_sites()}
            </Link>
          </CommandItem>
          {me.user.isAgencyAdmin ? (
            <CommandItem value="new site" onSelect={onNavigate} className="p-0">
              <Link
                to="/admin/organizations"
                onClick={onNavigate}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-ds-label-md"
              >
                <Plus />
                {m.shell_switcher_new_site()}
              </Link>
            </CommandItem>
          ) : null}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/**
 * Navbar control that names the current site and opens the site list. On wide
 * screens it is a popover; below 900px the same list slides up in a drawer.
 * `g s` opens it from anywhere.
 */
export function SiteSwitcher({ me }: { me: Me }) {
  const [open, setOpen] = useState(false)
  const compact = useIsCompact()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const currentSiteId = siteIdFromPath(pathname)
  const site = findSite(me, currentSiteId)

  useEffect(() => setOpen(false), [pathname])

  // `g s` jumps to the switcher, unless the user is typing.
  useEffect(() => {
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (pending && key === 's') {
        pending = false
        event.preventDefault()
        setOpen(true)
        return
      }
      pending = key === 'g'
      if (pending) {
        clearTimeout(timer)
        timer = setTimeout(() => {
          pending = false
        }, 1200)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearTimeout(timer)
    }
  }, [])

  const renderTrigger = (withClick: boolean) => (
    <Button
      type="button"
      variant="ghost"
      data-testid="sites-nav"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={site ? site.name : m.shell_switcher_choose()}
      className={cn(
        'h-9 max-w-[16rem] gap-2 px-2',
        compact && 'w-9 justify-center px-0',
      )}
      onClick={withClick ? () => setOpen((value) => !value) : undefined}
    >
      <EntityIcon icon={Globe} size="sm" tone={site ? 'brand' : 'muted'} />
      {compact ? null : (
        <>
          <span className="min-w-0 truncate text-ds-label-md">
            {site ? site.name : m.shell_switcher_choose()}
          </span>
          <CaretUpDown className="shrink-0 text-icon-muted" />
        </>
      )}
    </Button>
  )

  if (compact) {
    return (
      <>
        {renderTrigger(true)}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="p-0">
            <SheetTitle className="sr-only">{m.shell_nav_sites()}</SheetTitle>
            <SwitcherList
              me={me}
              currentSiteId={currentSiteId}
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{renderTrigger(false)}</PopoverTrigger>
      <PopoverContent align="start" className="w-[22.5rem] p-0">
        <SwitcherList
          me={me}
          currentSiteId={currentSiteId}
          onNavigate={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
