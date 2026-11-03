import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CaretRight,
  Code,
  PencilSimpleLine,
  Plus,
  RocketLaunch,
  Stack,
} from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'
import { EntryThumb } from '#/features/collection/entry-cover'
import { useShell } from '#/components/shell/shell-context'
import { useSiteCollections } from '#/components/shell/sidebar'
import type { SidebarCollection } from '#/components/shell/sidebar'
import { UserAvatar } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { ConnectAiCard } from '#/features/connect-ai/connect-ai-card'
import { GLOBAL_ROUTE } from '#/features/globals/site-content'
import { greeting, greetingName } from '#/features/overview/greeting'
import { EmptyState } from '#/components/ui/empty-state'
import { InsetList, InsetRow } from '#/components/ui/inset-list'
import { PageHeader } from '#/components/ui/page-header'
import { QueryError } from '#/components/ui/query-error'
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
import { canGoLive, goLiveReason } from '#/features/golive/go-live-gate'
import { GoLiveButton, changesReadyLabel } from '#/features/golive/golive-tray'
import { useGoLive } from '#/features/golive/use-go-live'
import { usePendingEntries } from '#/features/golive/use-pending-entries'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { usePanel } from '#/features/shell/panel'
import { formatRelativeTime } from '#/lib/relative-time'
import { isDevSite } from '#/lib/site-environment'
import {
  canManageSite,
  collectionIcon,
  displayHost,
  newEntryLabel,
} from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import { listRecentEntriesFn } from '#/server/fn/content'

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
  const queryClient = useQueryClient()
  const { collections, isLoading, isError } = useSiteCollections(site.id, false)
  const name = greetingName(me.user.name, [site.organizationName, site.name])
  // Greeting depends on the viewer's clock: render it after mount.
  const [hello, setHello] = React.useState<string | null>(null)
  React.useEffect(() => setHello(greeting(name)), [name])

  const host = displayHost(site.productionUrl)

  return (
    <div className="grid gap-10" data-testid="site-overview">
      <PageHeader
        title={
          <span className="inline-block min-h-[38px]">{hello ?? ' '}</span>
        }
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
            ) : release.state === 'loading' ? (
              <Skeleton className="inline-block h-3.5 w-28" />
            ) : (
              <span>
                {isDevSite(site) ? m.dev_env_status() : m.shell_not_live_yet()}
              </span>
            )}
          </span>
        }
      />

      <AttentionStrip
        site={site}
        canPublish={manage}
        collections={collections}
      />

      <ConnectAiCard siteId={site.id} siteName={site.name} />

      {isError ? (
        <QueryError
          title={m.overview_load_error()}
          error={null}
          onRetry={() =>
            void queryClient.invalidateQueries({
              queryKey: queryKeys.collections(site.id),
            })
          }
        />
      ) : isLoading ? (
        <div className="grid gap-10" data-testid="overview-loading">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={index}
                className="h-[52px] rounded-card sm:h-[112px]"
              />
            ))}
          </div>
          <div className="grid gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 rounded-card" />
            ))}
          </div>
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          card
          icon={<Stack weight="duotone" />}
          title={m.overview_empty_title()}
          description={
            isAdmin ? m.overview_empty_admin() : m.overview_empty_member()
          }
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
            <h2
              id="overview-create"
              className="px-1 text-overline text-text-muted"
            >
              {m.overview_create()}
            </h2>
            <Stagger className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
              {collections.map((collection) => {
                const Icon = collectionIcon(collection.key, collection.label)
                return (
                  <StaggerItem key={collection.id}>
                    <Link
                      to="/sites/$siteId/c/$collectionKey/new"
                      params={{
                        siteId: site.id,
                        collectionKey: collection.key,
                      }}
                      data-testid={`create-${collection.key}`}
                      className="group/tile flex h-full min-h-11 items-center gap-2.5 rounded-[12px] border border-border-default bg-background-surface px-3 py-2.5 shadow-card outline-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raise focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:hover:translate-y-0 sm:flex-col sm:items-start sm:gap-3 sm:rounded-card sm:p-4"
                    >
                      <span className="grid size-7 shrink-0 place-content-center rounded-[8px] bg-accent-soft text-icon-accent sm:size-9 sm:rounded-[10px]">
                        <Icon className="size-4 sm:size-[18px]" />
                      </span>
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate text-[14px] leading-5 font-semibold text-text-primary sm:text-headline">
                          {newEntryLabel(collection.label)}
                        </span>
                        <span className="truncate text-mono text-text-muted max-sm:hidden">
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
            <h2
              id="overview-activity"
              className="text-overline text-text-muted"
            >
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

/** Tighter on phones so two attention cards fit above the fold. */
const ATTENTION_CARD = 'gap-3 max-sm:gap-2.5 max-sm:p-4'

/** Cards that appear only when something needs you (brief §3.3). */
function AttentionStrip({
  site,
  canPublish,
  collections,
}: {
  site: MeSite
  canPublish: boolean
  collections: SidebarCollection[]
}) {
  const release = useReleaseStatus(site.id)
  const panel = usePanel()
  // Releases (go live, failed builds, scheduled changes) do not apply to a
  // development environment (Decision 7); its drafts card still does.
  const dev = isDevSite(site)
  const { goLive, isPending } = useGoLive(site.id)
  const pending = usePendingEntries({
    siteId: site.id,
    enabled: release.state !== 'loading',
  })
  // Same rule as the Go-live panel: no Go live until the change list loaded.
  const goLiveAllowed =
    canGoLive({
      canPublish,
      blockers: release.data?.blockers,
    }) && pending.isSuccess
  const goLiveHint = goLiveReason({
    canPublish,
    blockers: release.data?.blockers,
    changesKnown: pending.isSuccess,
  })

  const cards: React.ReactNode[] = []

  if (!dev && release.state === 'failed') {
    cards.push(
      <Card
        key="failed"
        className={ATTENTION_CARD}
        data-testid="attention-failed"
      >
        <div className="flex items-start gap-3">
          <FailedIcon size={20} className="mt-0.5 text-icon-error" />
          <div className="grid gap-0.5">
            <p className="text-headline text-text-primary">
              {m.overview_release_failed()}
            </p>
            <p className="text-callout text-text-secondary">
              {m.overview_release_failed_body()}
            </p>
            {release.lastFailure?.error ? (
              <p
                className="line-clamp-1 text-caption font-normal text-text-muted"
                title={release.lastFailure.error}
              >
                {release.lastFailure.error}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() =>
            panel.open('golive', {
              release: release.lastFailure?.publicationId,
            })
          }
        >
          {m.golive_see_what_happened()}
        </Button>
      </Card>,
    )
  }

  if (!dev && release.pending > 0 && release.state !== 'going-live') {
    cards.push(
      <Card
        key="ready"
        className={ATTENTION_CARD}
        data-testid="attention-ready"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-5 place-content-center rounded-full bg-accent-soft">
            <RocketLaunch weight="fill" className="size-3 text-icon-accent" />
          </span>
          <div className="grid min-w-0 flex-1 gap-2">
            {/* A count the list could not confirm is not a headline. */}
            <p className="text-headline text-text-primary tnum">
              {pending.isError
                ? m.golive_changes_load_error()
                : changesReadyLabel(release.pending)}
            </p>
            {pending.isError ? (
              <button
                type="button"
                onClick={pending.refetch}
                disabled={pending.isRetrying}
                className="justify-self-start text-callout text-text-accent hover:underline disabled:opacity-60"
              >
                {m.ui_try_again()}
              </button>
            ) : pending.ready.length > 0 ? (
              <ul className="grid gap-1 max-sm:[&>li:nth-child(n+3)]:hidden">
                {pending.ready.slice(0, 3).map((entry) => (
                  <li
                    key={entry.id}
                    className="truncate text-callout text-text-secondary"
                  >
                    <Link
                      {...(entry.global
                        ? {
                            to: GLOBAL_ROUTE,
                            params: {
                              siteId: site.id,
                              globalKey: entry.collectionKey,
                            },
                          }
                        : {
                            to: '/sites/$siteId/c/$collectionKey/$entryId' as const,
                            params: {
                              siteId: site.id,
                              collectionKey: entry.collectionKey,
                              entryId: entry.id,
                            },
                          })}
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
            canPublish={goLiveAllowed}
            reason={goLiveHint}
            pending={isPending}
            testId="overview-go-live"
            fullWidth={false}
            onGoLive={() => {
              void goLive().then((result) => {
                if ('ok' in result && result.ok === false) panel.open('golive')
              })
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => panel.open('golive')}
          >
            {m.overview_review_changes()}
            <CaretRight className="size-3" />
          </Button>
        </div>
      </Card>,
    )
  }

  if (!dev && pending.scheduled.length > 0) {
    cards.push(
      <Card
        key="scheduled"
        className={ATTENTION_CARD}
        data-testid="attention-scheduled"
      >
        <div className="flex items-start gap-3">
          <ClockIcon size={20} className="mt-0.5 text-icon-warning" />
          <div className="grid min-w-0 flex-1 gap-2">
            <p className="text-headline text-text-primary tnum">
              {m.overview_scheduled({ count: pending.scheduled.length })}
            </p>
            <ul className="grid gap-1 max-sm:[&>li:nth-child(n+3)]:hidden">
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

  const drafts = useDraftsWaiting(site.id, collections, canPublish)
  if (drafts.total > 0 && drafts.items.length > 0) {
    cards.push(
      <Card
        key="drafts"
        className={ATTENTION_CARD}
        data-testid="attention-drafts"
      >
        <div className="flex items-start gap-3">
          <PencilSimpleLine
            size={20}
            className="mt-0.5 shrink-0 text-icon-muted"
          />
          <div className="grid min-w-0 flex-1 gap-2">
            <p className="text-headline text-text-primary tnum">
              {drafts.total === 1
                ? m.overview_drafts_waiting_one()
                : m.overview_drafts_waiting_other({ count: drafts.total })}
            </p>
            <ul className="grid gap-1.5 max-sm:[&>li:nth-child(n+3)]:hidden">
              {drafts.items.map((draft) => (
                <li key={draft.id} className="grid min-w-0">
                  <Link
                    to="/sites/$siteId/c/$collectionKey/$entryId"
                    params={{
                      siteId: site.id,
                      collectionKey: draft.collectionKey,
                      entryId: draft.id,
                    }}
                    className="truncate text-callout text-text-secondary hover:text-text-primary hover:underline"
                  >
                    {draft.title}
                  </Link>
                  <span className="truncate text-caption font-normal text-text-muted">
                    {m.overview_drafts_by({
                      name: draft.by,
                      time: formatRelativeTime(draft.updatedAt),
                    })}
                  </span>
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
      data-testid="attention-strip"
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-2.5 sm:gap-3"
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
  const recent = useQuery({
    queryKey: queryKeys.recentEntries(site.id, 'recent'),
    queryFn: () => listRecentEntriesFn({ data: { siteId: site.id, limit: 8 } }),
    staleTime: 15_000,
  })
  const loading = recent.isLoading
  const failed = recent.isError ? recent : undefined
  const byKey = new Map(collections.map((c) => [c.key, c]))

  const rows = (recent.data?.items ?? []).flatMap((row) => {
    const collection = byKey.get(row.collectionKey)
    return collection ? [{ row, collection }] : []
  })

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
      ) : failed && rows.length === 0 ? (
        <QueryError
          error={failed.error}
          retrying={recent.isFetching}
          onRetry={() => void recent.refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-callout text-text-secondary">
          {m.overview_recent_empty()}
        </p>
      ) : (
        <InsetList data-testid="recently-edited">
          {rows.map(({ row, collection }) => {
            const state = entryLiveState(
              row,
              release.liveMembership,
              isDevSite(site),
            )
            return (
              <InsetRow
                key={row.id}
                asChild
                leading={<EntryThumb assetId={row.cover ?? undefined} />}
                title={row.title}
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
                      <UserAvatar
                        name={row.updatedByName}
                        size="sm"
                        className="max-sm:hidden"
                      />
                    ) : null}
                  </>
                }
              >
                <Link
                  to="/sites/$siteId/c/$collectionKey/$entryId"
                  params={{
                    siteId: site.id,
                    collectionKey: collection.key,
                    entryId: row.id,
                  }}
                />
              </InsetRow>
            )
          })}
        </InsetList>
      )}
    </section>
  )
}

/**
 * Owners and admins: recent drafts written by other people, newest first
 * (brief §3.3 "Drafts waiting"): the newest three and how many there are,
 * in one query for the whole site.
 */
function useDraftsWaiting(
  siteId: string,
  collections: SidebarCollection[],
  enabled: boolean,
) {
  const result = useQuery({
    queryKey: queryKeys.recentEntries(siteId, 'drafts-by-others'),
    queryFn: () =>
      listRecentEntriesFn({
        data: { siteId, draftsByOthers: true, limit: 3 },
      }),
    enabled,
    staleTime: 30_000,
  })
  if (!enabled || !result.data) return { total: 0, items: [] }
  const keys = new Set(collections.map((c) => c.key))
  return {
    total: result.data.total,
    items: result.data.items
      .filter((row) => keys.has(row.collectionKey))
      .map((row) => ({
        id: row.id,
        collectionKey: row.collectionKey,
        title: row.title,
        by: row.updatedByName ?? '',
        updatedAt: row.updatedAt,
      })),
  }
}
