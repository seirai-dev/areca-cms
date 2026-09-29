import * as React from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CaretRight,
  Code,
  Plus,
  RocketLaunch,
  Stack,
} from '@phosphor-icons/react'

import { queryKeys } from '#/components/editor/query-keys'
import { EntryThumb } from '#/components/editor/entry-thumb'
import { entryTitle } from '#/components/editor/utils'
import { useShell } from '#/components/shell/shell-context'
import { useSiteCollections } from '#/components/shell/sidebar'
import type { SidebarCollection } from '#/components/shell/sidebar'
import { UserAvatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { Skeleton } from '#/components/ui/skeleton'
import { Stagger, StaggerItem } from '#/components/ui/stagger'
import {
  ClockIcon,
  EntryStatusPill,
  FailedIcon,
  formatScheduleShort,
} from '#/components/ui/status-pill'
import { ActivityList } from '#/features/activity/activity-list'
import { entryLiveState } from '#/features/golive/entry-live-state'
import { GoLiveButton, changesReadyLabel } from '#/features/golive/golive-tray'
import { useGoLive } from '#/features/golive/use-go-live'
import { usePendingEntries } from '#/features/golive/use-pending-entries'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { usePanel } from '#/features/shell/panel'
import { formatRelativeTime } from '#/lib/relative-time'
import {
  canManageSite,
  collectionIcon,
  displayHost,
  newEntryLabel,
} from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import type { EntryData, EntryStatus } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { listEntriesFn } from '#/server/fn/content'

type RecentRow = {
  id: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  publishedData: EntryData | null
  updatedAt: string | Date
  scheduledAt: string | Date | null
  updatedByName: string | null
}

/** "Good morning, Kaan" by the local hour. */
export function greeting(firstName: string, hour = new Date().getHours()) {
  if (hour < 5 || hour >= 18) return m.overview_greeting_evening({ name: firstName })
  if (hour < 12) return m.overview_greeting_morning({ name: firstName })
  return m.overview_greeting_afternoon({ name: firstName })
}

/**
 * Site Overview (brief §3.3), phase 1: greeting, the attention strip, create
 * tiles, recently edited and recent activity. Phase 2 completes it (owner
 * "Drafts waiting", scheduled detail, illustrations).
 */
export function OverviewScreen({ site }: { site: MeSite }) {
  const { me } = useShell()
  const manage = canManageSite(me, site.organizationId)
  const isAdmin = me.user.isAgencyAdmin
  const release = useReleaseStatus(site.id)
  const { collections, isLoading } = useSiteCollections(site.id, false)
  const firstName = me.user.name.split(/\s+/)[0] || me.user.name
  // Greeting depends on the viewer's clock: render it after mount.
  const [hello, setHello] = React.useState<string | null>(null)
  React.useEffect(() => setHello(greeting(firstName)), [firstName])

  const host = displayHost(site.productionUrl)

  return (
    <div className="grid gap-10" data-testid="site-overview">
      <PageHeader
        title={<span className="inline-block min-h-[38px]">{hello ?? ' '}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-1.5">
            <span className="text-text-primary">{site.name}</span>
            <span aria-hidden="true">·</span>
            {release.live ? (
              <a
                href={site.productionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-text-accent hover:underline"
              >
                {m.overview_live_at({ host })}
                <ArrowUpRight className="size-3.5" />
              </a>
            ) : (
              <span>{m.shell_not_live_yet()}</span>
            )}
          </span>
        }
      />

      <AttentionStrip site={site} canPublish={manage} />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[104px] rounded-card" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          card
          icon={<Stack weight="duotone" />}
          title={m.overview_empty_title()}
          description={isAdmin ? m.overview_empty_admin() : m.overview_empty_member()}
          action={
            isAdmin ? (
              <>
                <Button asChild>
                  <Link
                    to="/sites/$siteId/settings"
                    params={{ siteId: site.id }}
                    search={{ tab: 'developer' }}
                  >
                    <Code />
                    {m.overview_connect_project()}
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link
                    to="/sites/$siteId/settings"
                    params={{ siteId: site.id }}
                    search={{ tab: 'content' }}
                  >
                    <Plus />
                    {m.overview_create_by_hand()}
                  </Link>
                </Button>
              </>
            ) : null
          }
        />
      ) : (
        <>
          <section className="grid gap-3" aria-labelledby="overview-create">
            <h2 id="overview-create" className="px-1 text-overline text-text-muted">
              {m.overview_create()}
            </h2>
            <Stagger className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {collections.map((collection) => {
                const Icon = collectionIcon(collection.key, collection.label)
                return (
                  <StaggerItem key={collection.id}>
                    <Link
                      to="/sites/$siteId/c/$collectionKey/new"
                      params={{ siteId: site.id, collectionKey: collection.key }}
                      data-testid={`create-${collection.key}`}
                      className="group/tile flex h-full flex-col gap-3 rounded-card border border-border-default bg-background-surface p-4 shadow-card outline-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raise focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:hover:translate-y-0"
                    >
                      <span className="grid size-9 place-content-center rounded-[10px] bg-accent-soft text-icon-accent">
                        <Icon size={18} />
                      </span>
                      <span className="grid gap-0.5">
                        <span className="text-headline text-text-primary">
                          {newEntryLabel(collection.label)}
                        </span>
                        <span className="truncate text-mono text-text-muted">
                          {collection.routePattern}
                        </span>
                      </span>
                    </Link>
                  </StaggerItem>
                )
              })}
            </Stagger>
          </section>

          <RecentlyEdited site={site} collections={collections} />
        </>
      )}

      {manage ? (
        <section className="grid gap-3" aria-labelledby="overview-activity">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 id="overview-activity" className="text-overline text-text-muted">
              {m.activity_title()}
            </h2>
            <SeeAllActivity />
          </div>
          <Card>
            <ActivityList
              organizationId={site.organizationId}
              siteId={site.id}
              pageSize={5}
              paged={false}
              grouped={false}
              showScope={false}
            />
          </Card>
        </section>
      ) : null}
    </div>
  )
}

function SeeAllActivity() {
  const panel = usePanel()
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="text-callout"
      onClick={() => panel.open('activity')}
      data-testid="overview-see-activity"
    >
      {m.overview_see_all_activity()}
    </Button>
  )
}

/** Cards that appear only when something needs you (brief §3.3). */
function AttentionStrip({ site, canPublish }: { site: MeSite; canPublish: boolean }) {
  const release = useReleaseStatus(site.id)
  const panel = usePanel()
  const { goLive, isPending } = useGoLive(site.id)
  const pending = usePendingEntries({
    siteId: site.id,
    liveCreatedAt: release.live?.createdAt,
    enabled: release.state !== 'loading',
  })

  const cards: React.ReactNode[] = []

  if (release.state === 'failed') {
    cards.push(
      <Card key="failed" className="gap-3" data-testid="attention-failed">
        <div className="flex items-start gap-3">
          <FailedIcon size={20} className="mt-0.5 text-icon-error" />
          <div className="grid gap-0.5">
            <p className="text-headline text-text-primary">{m.overview_release_failed()}</p>
            <p className="line-clamp-2 text-callout text-text-secondary">
              {release.lastFailure?.error ?? m.golive_hero_failed()}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="justify-self-start"
          onClick={() =>
            panel.open('golive', { release: release.lastFailure?.publicationId })
          }
        >
          {m.golive_see_what_happened()}
        </Button>
      </Card>,
    )
  }

  if (release.pending > 0 && release.state !== 'going-live') {
    cards.push(
      <Card key="ready" className="gap-3" data-testid="attention-ready">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-5 place-content-center rounded-full bg-accent-soft">
            <RocketLaunch weight="fill" className="size-3 text-icon-accent" />
          </span>
          <div className="grid min-w-0 flex-1 gap-2">
            <p className="text-headline text-text-primary tnum">
              {changesReadyLabel(release.pending)}
            </p>
            {pending.ready.length > 0 ? (
              <ul className="grid gap-1">
                {pending.ready.slice(0, 3).map((entry) => (
                  <li key={entry.id} className="truncate text-callout text-text-secondary">
                    <Link
                      to="/sites/$siteId/c/$collectionKey/$entryId"
                      params={{
                        siteId: site.id,
                        collectionKey: entry.collectionKey,
                        entryId: entry.id,
                      }}
                      className="hover:text-text-primary hover:underline"
                    >
                      {entry.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GoLiveButton
            canPublish={canPublish}
            pending={isPending}
            testId="overview-go-live"
            className="w-auto"
            onGoLive={() => {
              void goLive().then((result) => {
                if (result && 'ok' in result && result.ok === false) panel.open('golive')
              })
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => panel.open('golive')}>
            {m.overview_review_changes()}
            <CaretRight className="size-3" />
          </Button>
        </div>
      </Card>,
    )
  }

  if (pending.scheduled.length > 0) {
    cards.push(
      <Card key="scheduled" className="gap-3" data-testid="attention-scheduled">
        <div className="flex items-start gap-3">
          <ClockIcon size={20} className="mt-0.5 text-icon-warning" />
          <div className="grid min-w-0 flex-1 gap-2">
            <p className="text-headline text-text-primary tnum">
              {m.overview_scheduled({ count: pending.scheduled.length })}
            </p>
            <ul className="grid gap-1">
              {pending.scheduled.slice(0, 3).map((entry) => (
                <li
                  key={entry.id}
                  className="flex min-w-0 items-center justify-between gap-3 text-callout text-text-secondary"
                >
                  <span className="truncate">{entry.title}</span>
                  {entry.scheduledAt ? (
                    <span className="shrink-0 text-text-muted tnum">
                      {formatScheduleShort(entry.scheduledAt)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>,
    )
  }

  if (cards.length === 0) return null
  return (
    <section
      aria-label={m.overview_attention()}
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {cards}
    </section>
  )
}

/** Up to 8 entries across collections, newest first. */
function RecentlyEdited({
  site,
  collections,
}: {
  site: MeSite
  collections: SidebarCollection[]
}) {
  const release = useReleaseStatus(site.id)
  const results = useQueries({
    queries: collections.map((collection) => ({
      queryKey: [...queryKeys.entries(site.id, collection.key), 'recent'] as const,
      queryFn: () =>
        listEntriesFn({
          data: { siteId: site.id, collectionKey: collection.key, limit: 8, offset: 0 },
        }),
      staleTime: 15_000,
    })),
  })
  const loading = results.some((result) => result.isLoading)

  const rows = collections
    .flatMap((collection, index) =>
      ((results[index]?.data?.items ?? []) as RecentRow[]).map((row) => ({
        row,
        collection,
        fields: collection.fields,
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.row.updatedAt).getTime() - new Date(a.row.updatedAt).getTime(),
    )
    .slice(0, 8)

  return (
    <section className="grid gap-3" aria-labelledby="overview-recent">
      <h2 id="overview-recent" className="px-1 text-overline text-text-muted">
        {m.overview_recently_edited()}
      </h2>
      {loading && rows.length === 0 ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-callout text-text-secondary">
          {m.overview_recent_empty()}
        </p>
      ) : (
        <InsetList data-testid="recently-edited">
          {rows.map(({ row, collection, fields }) => {
            const state = entryLiveState(row, release.data ? release.live : undefined)
            const imageField = fields.find((field) => field.type === 'image')
            const cover = imageField ? row.draftData[imageField.key] : undefined
            return (
              <InsetRow
                key={row.id}
                asChild
                leading={
                  <EntryThumb assetId={typeof cover === 'string' ? cover : undefined} />
                }
                title={entryTitle(row.draftData, fields, row.slug)}
                subtitle={
                  <span className="text-caption font-normal text-text-muted">
                    {collection.label}
                    {' · '}
                    {formatRelativeTime(row.updatedAt)}
                  </span>
                }
                trailing={
                  <>
                    <EntryStatusPill
                      status={state.status}
                      scheduledAt={state.scheduledAt}
                      editedSinceReady={state.editedSinceReady}
                      size="sm"
                    />
                    {row.updatedByName ? (
                      <UserAvatar name={row.updatedByName} size="sm" className="max-sm:hidden" />
                    ) : null}
                  </>
                }
              >
                <Link
                  to="/sites/$siteId/c/$collectionKey/$entryId"
                  params={{ siteId: site.id, collectionKey: collection.key, entryId: row.id }}
                />
              </InsetRow>
            )
          })}
        </InsetList>
      )}
    </section>
  )
}
