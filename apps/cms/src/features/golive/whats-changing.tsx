import { Link } from '@tanstack/react-router'
import { Minus, Translate, WarningCircle } from '@phosphor-icons/react'

import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { ClockIcon, formatScheduleShort } from '#/components/ui/status-pill'
import { contentRoute } from '#/lib/content-route'
import { formatRelativeTime } from '#/lib/relative-time'
import { uiLanguageName } from '#/lib/site-languages'
import { m } from '#/paraglide/messages'

import type {
  PendingEntry,
  PendingLanguages,
  PendingLinkWarning,
  usePendingEntries,
} from './use-pending-entries'

const ROW_CLASS =
  'group/row flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-1.5 outline-none transition-colors hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus'

export function WhatsChanging({
  siteId,
  pending,
  demo = false,
}: {
  siteId: string
  pending: ReturnType<typeof usePendingEntries>
  demo?: boolean
}) {
  if (pending.isError) {
    return (
      <QueryError
        title={m.golive_changes_load_error()}
        error={pending.error}
        onRetry={pending.refetch}
        retrying={pending.isRetrying}
      />
    )
  }
  if (pending.isLoading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-[10px]" />
        ))}
      </div>
    )
  }
  const warnings = (
    <>
      {pending.linkWarnings.length > 0 ? (
        <LinkWarningList siteId={siteId} warnings={pending.linkWarnings} />
      ) : null}
    </>
  )
  if (pending.entries.length === 0 && !pending.languages) {
    return (
      <div className="grid gap-3">
        {warnings}
        {pending.linkWarnings.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-border-strong px-4 py-4 text-center text-callout text-text-secondary">
            {demo
              ? m.golive_demo_nothing_to_publish()
              : m.golive_nothing_changing()}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      {warnings}
      <ul className="-mx-2 grid" data-testid="golive-changes">
        {pending.languages ? (
          <li key="languages">
            <LanguageRow languages={pending.languages} />
          </li>
        ) : null}
        {pending.entries.map((entry) => (
          <li key={`${entry.kind}-${entry.id}`}>
            <PendingRow siteId={siteId} entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Links that will not work after go live. They never block the release: the
 * text is published, the link is not. Each row opens the entry that holds it.
 */
function LinkWarningList({
  siteId,
  warnings,
}: {
  siteId: string
  warnings: PendingLinkWarning[]
}) {
  const count = warnings.length
  return (
    <section
      className="rounded-[12px] border border-border-strong px-3 py-3"
      data-testid="golive-link-warnings"
    >
      <div className="flex items-start gap-2">
        <WarningCircle className="mt-0.5 size-4 shrink-0 text-icon-warning" />
        <div className="grid min-w-0 gap-0.5">
          <p className="text-[14px] leading-5 font-medium text-text-primary">
            {count === 1
              ? m.golive_links_title_one()
              : m.golive_links_title_many({ count })}
          </p>
          <p className="text-[12px] leading-4 text-text-muted">
            {m.golive_links_hint()}
          </p>
        </div>
      </div>
      <ul className="mt-2 -mx-2 grid">
        {warnings.map((warning) => (
          <li
            key={`${warning.sourceEntryId}-${warning.locale ?? ''}-${warning.field}-${warning.targetEntryId}-${warning.anchor ?? ''}-${warning.reason}`}
          >
            <LinkWarningRow siteId={siteId} warning={warning} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function LinkWarningRow({
  siteId,
  warning,
}: {
  siteId: string
  warning: PendingLinkWarning
}) {
  const reason =
    warning.reason === 'missing-section'
      ? m.golive_link_reason_section({
          target: warning.targetTitle,
          anchor: warning.anchor ?? '',
        })
      : warning.reason === 'missing'
        ? m.golive_link_reason_missing()
        : m.golive_link_reason_not_live({ target: warning.targetTitle })
  const language = warning.locale ? uiLanguageName(warning.locale) : null
  const body = (
    <span className="grid min-w-0 flex-1">
      <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
        {warning.sourceTitle}
      </span>
      <span className="truncate text-[12px] leading-4 text-text-muted">
        {language ? `${language} · ` : ''}
        {reason}
      </span>
    </span>
  )
  return (
    <Link
      {...contentRoute({
        siteId,
        collectionKey: warning.sourceCollectionKey,
        entryId: warning.sourceEntryId,
        global: warning.sourceGlobal,
      })}
      className={ROW_CLASS}
    >
      {body}
    </Link>
  )
}

/** The site's language set or main language changes with the next go live. */
function LanguageRow({ languages }: { languages: PendingLanguages }) {
  const parts = [
    ...languages.added.map((locale) =>
      m.golive_language_added({ language: uiLanguageName(locale) }),
    ),
    ...languages.removed.map((locale) =>
      m.golive_language_removed({ language: uiLanguageName(locale) }),
    ),
    ...(languages.mainChanged
      ? [
          m.golive_language_main({
            from: uiLanguageName(languages.mainChanged.from),
            to: uiLanguageName(languages.mainChanged.to),
          }),
        ]
      : []),
  ]
  return (
    <div
      className="flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-1.5"
      data-testid="golive-language-change"
    >
      <span className="grid size-6 shrink-0 place-content-center">
        <Translate className="size-4 text-icon-accent" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-[14px] leading-5 font-medium text-text-primary">
          {m.golive_languages_row()}
        </span>
        <span className="text-[12px] leading-4 text-text-muted">
          {parts.join(' · ')}
        </span>
      </span>
    </div>
  )
}

function PendingRow({
  siteId,
  entry,
}: {
  siteId: string
  entry: PendingEntry
}) {
  const meta =
    entry.kind === 'scheduled' && entry.scheduledAt
      ? m.golive_scheduled_for({
          time: formatScheduleShort(entry.scheduledAt),
        })
      : entry.kind === 'removal'
        ? m.golive_will_leave_live()
        : entry.updatedByName
          ? m.golive_edited_by({
              time: formatRelativeTime(entry.updatedAt),
              name: entry.updatedByName,
            })
          : m.golive_edited({ time: formatRelativeTime(entry.updatedAt) })

  const icon =
    entry.kind === 'scheduled' ? (
      <ClockIcon size={16} className="text-icon-warning" />
    ) : entry.kind === 'removal' ? (
      <Minus className="size-3.5 text-icon-muted" />
    ) : (
      <span className="size-2 rounded-full bg-accent" />
    )

  const body = (
    <>
      <span className="grid size-6 shrink-0 place-content-center">{icon}</span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[14px] leading-5 font-medium text-text-primary">
          {entry.title}
        </span>
        <span className="truncate text-[12px] leading-4 text-text-muted">
          {entry.collectionLabel}
          {' · '}
          {meta}
        </span>
      </span>
    </>
  )

  if (!entry.exists) {
    return <div className={ROW_CLASS}>{body}</div>
  }

  return (
    <Link
      {...contentRoute({
        siteId,
        collectionKey: entry.collectionKey,
        entryId: entry.id,
        global: entry.global,
      })}
      className={ROW_CLASS}
    >
      {body}
    </Link>
  )
}
