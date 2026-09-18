import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { EntityIcon } from '#/components/entity-icon'
import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { useSiteLiveState } from '#/components/editor/release-status-bar'
import { isSectionActive } from '#/lib/site-nav'
import type { MeSite, SiteSection } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { ArrowSquareOut, Buildings, Globe } from '@phosphor-icons/react'
import type { Icon as IconComponent } from '@phosphor-icons/react'

/**
 * The 44px row that sits directly under the navbar and names the thing the
 * page is about: a site (icon, name, live dot, slug, link out) or an
 * organization. Section tabs live on its right.
 */
export function IdentityStrip({
  icon,
  name,
  meta,
  badge,
  actions,
  tabs,
  bleed = true,
}: {
  icon: IconComponent
  name: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  /** Break out of the page gutter so the band spans the page frame. */
  bleed?: boolean
}) {
  return (
    <div
      className={cn(
        'sticky top-(--navbar-height) z-navbar mb-6 border-b border-border-subtle bg-background-default/90 backdrop-blur',
        bleed && '-mx-6 -mt-6 px-6',
      )}
    >
      <div className="flex h-11 items-center gap-3">
        <EntityIcon icon={icon} size="sm" />
        <span className="min-w-0 shrink truncate text-ds-label-md text-text-primary">
          {name}
        </span>
        {badge}
        {meta ? (
          <span className="hidden min-w-0 shrink items-center gap-2 sm:flex">
            {meta}
          </span>
        ) : null}
        {actions}
        {tabs ? <div className="ml-auto min-w-0">{tabs}</div> : null}
      </div>
    </div>
  )
}

/** Green dot shown only while the site has a live release. */
function LiveDot({ siteId }: { siteId: string }) {
  const live = useSiteLiveState(siteId)
  if (!live?.liveSince) return null
  const label = m.shell_live_since({ time: live.liveSince.toLocaleString() })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="site-live-dot"
          aria-label={label}
          className="size-2 shrink-0 rounded-full bg-status-success"
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function SiteTabs({
  sections,
  pathname,
}: {
  sections: SiteSection[]
  pathname: string
}) {
  return (
    <nav
      aria-label={m.sites_sections_label()}
      data-testid="site-nav"
      className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex items-center gap-5">
        {sections.map((section) => {
          const active = isSectionActive(section, pathname)
          return (
            <li key={section.key} className="shrink-0">
              <Link
                to={section.href}
                data-testid={section.testId}
                // TanStack Link marks itself active with a fuzzy prefix match,
                // which lights up Content on every nested site route. Pin it to
                // an exact match and drive the underline from `isSectionActive`.
                activeOptions={{ exact: true, includeSearch: false }}
                aria-current={active ? 'page' : undefined}
                data-active={active ? 'true' : undefined}
                className={cn('nav-tab h-11')}
              >
                {section.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function SiteIdentityStrip({
  site,
  sections,
  pathname,
}: {
  site: MeSite
  sections: SiteSection[]
  pathname: string
}) {
  return (
    <IdentityStrip
      icon={Globe}
      name={site.name}
      badge={<LiveDot siteId={site.id} />}
      meta={
        <span
          data-testid="site-header-slug"
          className="truncate text-ds-mono-xs text-text-muted"
        >
          {site.slug}
        </span>
      }
      actions={
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          aria-label={m.sites_open_live_site()}
        >
          <a href={site.productionUrl} target="_blank" rel="noreferrer">
            <ArrowSquareOut />
          </a>
        </Button>
      }
      tabs={<SiteTabs sections={sections} pathname={pathname} />}
    />
  )
}

export function OrgIdentityStrip({
  name,
  slug,
  tabs,
  bleed,
}: {
  name: string
  slug?: string
  tabs?: ReactNode
  bleed?: boolean
}) {
  return (
    <IdentityStrip
      bleed={bleed}
      icon={Buildings}
      name={name}
      meta={
        slug ? (
          <span className="truncate text-ds-mono-xs text-text-muted">
            {slug}
          </span>
        ) : undefined
      }
      tabs={tabs}
    />
  )
}
