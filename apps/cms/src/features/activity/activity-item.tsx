import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckCircle, XCircle } from '@phosphor-icons/react'

import { SystemAvatar, UserAvatar } from '#/components/ui/avatar'
import { Tag } from '#/components/ui/tag'
import { RelativeTime, TimelineItem } from '#/components/ui/timeline'
import { contentRoute } from '#/lib/content-route'
import { ACTIVITY_ENTRIES_MAX_IDS } from '#/lib/content-limits'
import { m } from '#/paraglide/messages'
import { getActivityEntriesFn } from '#/server/fn/activity-entries'
import { activityParts, entryTargetIds, viaMcpKey } from './activity-sentence'
import type { ActivityLike } from './activity-sentence'

type EntryRef = {
  title: string | null
  collectionKey: string
  siteId: string
  /** A site content section: its key is `collectionKey`, the link goes to the section. */
  global: boolean
}

/**
 * Titles (and editor links) for the entries a page of activity mentions. One
 * server call per chunk of ids, not one per entry. The result is cached under
 * its own key: it is not the editor's entry record. Entries that are gone or
 * not visible to the viewer are absent; the caller falls back to the slug.
 */
export function useActivityEntries(rows: ReadonlyArray<ActivityLike>) {
  const ids = [...entryTargetIds(rows)].sort()
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ACTIVITY_ENTRIES_MAX_IDS) {
    chunks.push(ids.slice(i, i + ACTIVITY_ENTRIES_MAX_IDS))
  }
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['activity-entries', chunk] as const,
      queryFn: () => getActivityEntriesFn({ data: { ids: chunk } }),
      staleTime: 60_000,
      retry: false,
    })),
  })
  const map = new Map<string, EntryRef>()
  for (const result of results) {
    for (const entry of result.data ?? []) {
      map.set(entry.id, {
        title: entry.title,
        collectionKey: entry.collectionKey,
        siteId: entry.siteId,
        global: entry.global,
      })
    }
  }
  return map
}

/**
 * One activity row: avatar (or a System glyph), the sentence with its target
 * in the primary colour (a link to the entry when it still exists), the time,
 * and a quiet scope/repeat line.
 */
export function ActivityTimelineItem({
  row,
  count = 1,
  entry,
  scope,
  testId = 'activity-item',
}: {
  row: ActivityLike
  count?: number
  entry?: EntryRef
  scope?: string | null
  testId?: string
}) {
  const parts = activityParts(row, entry?.title)
  const actor = parts.siteEvent ? null : row.actorName
  const capitalise = (value: string) =>
    actor ? value : value.charAt(0).toUpperCase() + value.slice(1)

  const target = parts.target ? (
    parts.named && entry ? (
      <Link
        {...contentRoute({ ...entry, entryId: row.targetId })}
        className="text-text-primary hover:underline"
      >
        {parts.target}
      </Link>
    ) : (
      <span className={parts.named ? 'text-text-primary' : undefined}>
        {parts.target}
      </span>
    )
  ) : null

  const before = parts.before ? capitalise(parts.before) : ''
  const repeat =
    count > 1
      ? row.action === 'entry.update'
        ? m.activity_repeat_saves({ count })
        : m.activity_repeat_times({ count })
      : null
  const metaLine = [scope, repeat].filter(Boolean).join(' · ')
  const via = viaMcpKey(row)
  const viaKey = via?.name ?? null

  const icon =
    row.action === 'publication.live' ? (
      <CheckCircle weight="fill" />
    ) : parts.siteEvent ? (
      <XCircle weight="fill" />
    ) : actor ? (
      <UserAvatar name={actor} size="md" className="size-7 text-[10.5px]" />
    ) : (
      <SystemAvatar size="md" className="size-7" label={m.activity_system()} />
    )

  return (
    <TimelineItem
      data-testid={testId}
      data-action={row.action}
      tone={
        row.action === 'publication.live'
          ? 'success'
          : parts.siteEvent
            ? 'error'
            : 'plain'
      }
      icon={icon}
      title={
        <span>
          {actor ? (
            <>
              <span className="text-text-primary">{actor}</span>{' '}
            </>
          ) : null}
          <span className="font-normal text-text-secondary">
            {before}
            {target}
            {parts.target ? parts.after : ''}
          </span>
        </span>
      }
      time={<RelativeTime value={row.createdAt} />}
      meta={
        metaLine || viaKey ? (
          <span className="flex flex-wrap items-center gap-2 text-caption font-normal text-text-muted">
            {metaLine}
            {viaKey ? (
              <Tag tone="accent" data-testid="activity-via-ai">
                {via?.agency
                  ? m.activity_via_agency_ai({ name: viaKey })
                  : m.activity_via_ai({ name: viaKey })}
              </Tag>
            ) : null}
          </span>
        ) : undefined
      }
    />
  )
}
