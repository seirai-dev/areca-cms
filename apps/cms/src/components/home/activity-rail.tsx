import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import {
  formatAuditAction,
  formatAuditTarget,
  formatDate,
} from '#/components/admin/helpers'
import { formatDateTime } from '#/components/editor/utils'
import { EntityIcon } from '#/components/entity-icon'
import { formatRelativeTime } from '#/lib/relative-time'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'
import type { getHomeActivityFn } from '#/server/fn/home'
import type { SiteOverviewRow } from '#/components/sites-table'
import { Globe } from '@phosphor-icons/react'

type HomeActivity = Awaited<ReturnType<typeof getHomeActivityFn>>
export type ScheduledEntry = HomeActivity['scheduled'][number]
export type ActivityRow = HomeActivity['activity'][number]

/** One flat block of the right rail: a title, a hairline, and rows. */
export function HomeBlock({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-3 border-b border-border-subtle pb-6 last:border-b-0 last:pb-0">
      <h2 className="text-ds-heading-6 text-text-primary">{title}</h2>
      {children}
    </section>
  )
}

function BlockEmpty({ children }: { children: ReactNode }) {
  return <p className="text-ds-body-sm text-text-muted">{children}</p>
}

function initials(name: string | null) {
  if (!name) return '·'
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

/** Sites with published entries the live snapshot does not include yet. */
export function NeedsPublishing({ sites }: { sites: SiteOverviewRow[] }) {
  // Long lists are noise; the table already carries the full picture.
  const waiting = sites.filter((site) => site.pendingEntries > 0).slice(0, 5)

  return (
    <HomeBlock title={m.home_needs_publishing_title()}>
      {waiting.length === 0 ? (
        <BlockEmpty>{m.home_needs_publishing_empty()}</BlockEmpty>
      ) : (
        <ul className="grid gap-1" data-testid="needs-publishing">
          {waiting.map((site) => (
            <li key={site.id} className="flex items-center gap-3 p-3">
              <EntityIcon icon={Globe} size="sm" tone="warning" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ds-body-sm text-text-primary">
                  {site.name}
                </p>
                <p className="text-ds-body-xs text-text-warning">
                  {site.pendingEntries === 1
                    ? m.home_changes_waiting_one({ count: site.pendingEntries })
                    : m.home_changes_waiting_other({
                        count: site.pendingEntries,
                      })}
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                  {m.home_publish()}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </HomeBlock>
  )
}

/** Entries that will publish themselves, soonest first. */
export function ScheduledEntries({ entries }: { entries: ScheduledEntry[] }) {
  return (
    <HomeBlock title={m.home_scheduled_title()}>
      {entries.length === 0 ? (
        <BlockEmpty>{m.home_scheduled_empty()}</BlockEmpty>
      ) : (
        <ul className="grid gap-2" data-testid="home-scheduled">
          {entries.map((item) => (
            <li
              key={item.id}
              className="flex items-baseline justify-between gap-3"
            >
              <div className="min-w-0">
                <Link
                  to="/sites/$siteId/c/$collectionKey/$entryId"
                  params={{
                    siteId: item.siteId,
                    collectionKey: item.collectionKey,
                    entryId: item.id,
                  }}
                  className="block truncate text-ds-body-sm text-text-primary hover:underline"
                >
                  {item.title}
                </Link>
                <p className="truncate text-ds-body-xs text-text-muted">
                  {item.siteName} · {item.collectionLabel}
                </p>
              </div>
              <time
                className="shrink-0 text-ds-body-xs whitespace-nowrap text-text-muted"
                title={formatDateTime(item.scheduledAt)}
              >
                {formatRelativeTime(item.scheduledAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </HomeBlock>
  )
}

/** The last few audit events the caller is allowed to see. */
export function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <HomeBlock title={m.home_activity_title()}>
      {rows.length === 0 ? (
        <BlockEmpty>{m.home_activity_empty()}</BlockEmpty>
      ) : (
        <ul className="grid gap-2" data-testid="home-activity">
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 p-3"
            >
              <Avatar className="size-6">
                <AvatarFallback className="text-[10px]">
                  {initials(row.actorName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 text-ds-body-sm">
                <p className="truncate">
                  <span className="font-medium">
                    {row.actorName ?? m.admin_audit_system()}
                  </span>{' '}
                  <span className="text-text-muted">
                    {formatAuditAction(row.action)}
                  </span>
                </p>
                <p className="truncate text-ds-body-xs text-text-muted">
                  {formatAuditTarget({
                    targetType: row.targetType,
                    targetId: row.targetId,
                    organizationName: row.organizationName,
                    siteName: row.siteName,
                    meta: row.meta,
                  })}
                </p>
              </div>
              <time
                className="text-ds-body-xs whitespace-nowrap text-text-muted"
                title={formatDate(row.createdAt)}
              >
                {formatRelativeTime(row.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </HomeBlock>
  )
}
