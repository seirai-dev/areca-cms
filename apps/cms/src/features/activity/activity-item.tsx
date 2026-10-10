import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckCircle, XCircle } from '@phosphor-icons/react'

import { SystemAvatar, UserAvatar } from '#/components/ui/avatar'
import { Tag } from '#/components/ui/tag'
import { RelativeTime, TimelineItem } from '#/components/ui/timeline'
import { queryKeys } from '#/lib/content/query-keys'
import type { EntryData } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { getEntryFn } from '#/server/fn/content'
import {
  activityParts,
  entryTargetIds,
  viaMcpKeyName,
} from './activity-sentence'
import type { ActivityLike } from './activity-sentence'

type EntryRef = {
  title: string | null
  collectionKey: string
  siteId: string
}

/** A readable title from entry data without its schema. */
function titleOf(data: EntryData | null | undefined) {
  if (!data) return null
  for (const key of ['title', 'name', 'heading', 'label']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * Titles (and editor links) for the entries a page of activity mentions.
 * Shares the editor's `['entry', id]` cache, so opening one is instant and
 * the lookups are not repeated. Deleted entries fall back to their slug.
 */
export function useActivityEntries(rows: ReadonlyArray<ActivityLike>) {
  const ids = entryTargetIds(rows)
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.entry(id),
      queryFn: () => getEntryFn({ data: { id } }),
      staleTime: 60_000,
      retry: false,
    })),
  })
  const map = new Map<string, EntryRef>()
  ids.forEach((id, index) => {
    const entry = results[index]?.data as
      | {
          siteId: string
          collectionKey?: string
          slug: string
          draftData?: EntryData
        }
      | null
      | undefined
    if (!entry?.collectionKey) return
    map.set(id, {
      title: titleOf(entry.draftData),
      collectionKey: entry.collectionKey,
      siteId: entry.siteId,
    })
  })
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
        to="/sites/$siteId/c/$collectionKey/$entryId"
        params={{
          siteId: entry.siteId,
          collectionKey: entry.collectionKey,
          entryId: row.targetId,
        }}
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
  const viaKey = viaMcpKeyName(row)

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
                {m.activity_via_ai({ name: viaKey })}
              </Tag>
            ) : null}
          </span>
        ) : undefined
      }
    />
  )
}
