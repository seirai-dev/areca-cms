import { Link } from '@tanstack/react-router'
import { ArrowRight, Gear } from '@phosphor-icons/react'

import { SiteTile } from '#/components/shell/site-tile'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { StatusPill } from '#/components/ui/status-pill'
import { formatRelativeTime } from '#/lib/relative-time'
import { displayHost } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'

export type SiteFigures = {
  live: boolean
  pendingEntries: number
  lastUpdated: string | Date
  collections: number
}

export type AgencySite = {
  id: string
  name: string
  slug: string
  productionUrl: string
  organizationName?: string
}

function Figures({
  figures,
  loading,
}: {
  figures: SiteFigures | undefined
  loading: boolean
}) {
  if (loading || !figures) {
    return <Skeleton className="h-[22px] w-24 rounded-full" />
  }
  return (
    <>
      {figures.live ? (
        <StatusPill
          tone="success"
          icon="live"
          pulse="none"
          label={m.shell_status_live()}
        />
      ) : (
        <StatusPill tone="neutral" label={m.shell_not_live_yet()} />
      )}
      {figures.pendingEntries > 0 ? (
        <StatusPill
          tone="accent"
          icon="dot"
          label={m.golive_pill_ready({ count: figures.pendingEntries })}
        />
      ) : null}
    </>
  )
}

function Head({ site, whisper }: { site: AgencySite; whisper: string }) {
  return (
    <div className="flex items-start gap-3">
      <SiteTile id={site.id} name={site.name} size="lg" />
      <div className="grid min-w-0 flex-1 gap-0.5 pt-0.5">
        <span className="truncate text-headline text-text-primary">
          {site.name}
        </span>
        <span className="truncate text-callout text-text-muted">{whisper}</span>
      </div>
    </div>
  )
}

/**
 * A site in the Agency workspace (brief §3.11): tile, name, host, live
 * state, "3 ready" and when it last changed.
 *
 * - Without `actions` the whole card opens the site workspace (overview grid).
 * - With `actions` (a client's Sites tab) the card carries "Open" and
 *   "Settings" buttons instead.
 */
export function AgencySiteCard({
  site,
  figures,
  loading,
  showClient = false,
  actions = false,
}: {
  site: AgencySite
  figures: SiteFigures | undefined
  loading: boolean
  showClient?: boolean
  actions?: boolean
}) {
  const host = displayHost(site.productionUrl)
  const whisper =
    showClient && site.organizationName
      ? `${site.organizationName} · ${host}`
      : host

  if (!actions) {
    return (
      <Link
        to="/sites/$siteId"
        params={{ siteId: site.id }}
        data-testid={`agency-site-${site.slug}`}
        className="block h-full rounded-card outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <Card
          interactive
          className="h-full min-h-[132px] justify-between gap-5"
        >
          <Head site={site} whisper={whisper} />
          <div className="flex flex-wrap items-center gap-2">
            <Figures figures={figures} loading={loading} />
            {figures && !loading ? (
              <span className="ml-auto text-caption font-normal text-text-muted">
                {m.sites_picker_updated({
                  time: formatRelativeTime(figures.lastUpdated),
                })}
              </span>
            ) : null}
          </div>
        </Card>
      </Link>
    )
  }

  return (
    <Card
      className="h-full justify-between gap-4"
      data-testid={`client-site-${site.slug}`}
    >
      <Head site={site} whisper={whisper} />
      <div className="flex flex-wrap items-center gap-2">
        <Figures figures={figures} loading={loading} />
        {figures && !loading ? (
          <span className="ml-auto text-caption font-normal text-text-muted">
            {m.sites_picker_updated({
              time: formatRelativeTime(figures.lastUpdated),
            })}
          </span>
        ) : null}
      </div>
      <div className="-mx-5 -mb-5 flex items-center gap-1 border-t border-border-default px-3 py-2">
        <Button asChild variant="ghost" size="sm">
          <Link
            to="/sites/$siteId"
            params={{ siteId: site.id }}
            data-testid={`open-site-${site.slug}`}
          >
            {m.agency_site_open()}
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
        <Button asChild variant="quiet" size="sm" className="ml-auto">
          <Link
            to="/sites/$siteId/settings"
            params={{ siteId: site.id }}
            data-testid={`site-settings-${site.slug}`}
          >
            <Gear />
            {m.shell_nav_settings()}
          </Link>
        </Button>
      </div>
    </Card>
  )
}
