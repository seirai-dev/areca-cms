import * as React from 'react'
import { ArrowCounterClockwise, CalendarX } from '@phosphor-icons/react'

import { formatDateTime, slugify } from '#/components/editor/utils'
import type { FieldErrorMap } from '#/components/editor/utils'
import { UserAvatar } from '#/components/ui/avatar'
import { CopyButton } from '#/components/ui/copy-button'
import { Hint } from '#/components/ui/tooltip'
import { RelativeTime } from '#/components/ui/timeline'
import { EntryPill } from '#/features/collection/entry-pill'
import type { ReleaseStatusData } from '#/features/golive/queries'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { displayHost } from '#/lib/site-nav'
import type { EntryData, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

import { FieldControl } from './fields/field-control'
import { EntryHistory } from './history'
import type { EntryRecord, RevisionRecord } from './use-entry-editor'

function Section({
  title,
  children,
  className,
  testId,
}: {
  title: string
  children: React.ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section className={cn('grid gap-2', className)} data-testid={testId}>
      <h2 className="px-1 text-overline text-text-muted">{title}</h2>
      <div className="grid gap-4 rounded-card border border-border-default bg-background-surface p-4">
        {children}
      </div>
    </section>
  )
}

/**
 * The editor's details panel (brief §3.5): grouped cards — Page (address
 * and slug), Fields (every structured field), Status (pill, schedule,
 * dates, author, id) and History.
 */
export function DetailsPanel({
  siteId,
  organizationId,
  productionUrl,
  routePattern,
  fields,
  slugField,
  titleField,
  data,
  errors,
  onChange,
  slugManual,
  onResetSlug,
  entry,
  live,
  isNew,
  canManage,
  revisions,
  revisionsLoading,
  revisionsError,
  onRetryRevisions,
  onRestore,
  onCancelSchedule,
}: {
  siteId: string
  organizationId: string
  productionUrl: string
  routePattern: string
  fields: Field[]
  slugField?: Field
  titleField?: Field
  data: EntryData
  errors: FieldErrorMap
  onChange: (key: string, value: unknown) => void
  slugManual: boolean
  onResetSlug: () => void
  entry: EntryRecord | null
  live: ReleaseStatusData['live'] | undefined
  isNew: boolean
  canManage: boolean
  revisions: RevisionRecord[]
  revisionsLoading: boolean
  revisionsError: unknown
  onRetryRevisions: () => void
  onRestore: (revisionId: string) => void
  onCancelSchedule: () => void
}) {
  return (
    <div className="grid gap-6" data-testid="entry-details">
      {slugField ? (
        <Section title={m.editor_details_page()} testId="details-page">
          <SlugEditor
            field={slugField}
            value={data[slugField.key]}
            onChange={(value) => onChange(slugField.key, value)}
            error={errors[slugField.key]}
            host={displayHost(productionUrl)}
            routePattern={routePattern}
            showReset={
              slugManual &&
              Boolean(titleField) &&
              typeof data[titleField!.key] === 'string' &&
              Boolean((data[titleField!.key] as string).trim()) &&
              slugify(data[titleField!.key] as string) !== data[slugField.key]
            }
            onReset={onResetSlug}
          />
        </Section>
      ) : null}

      {fields.length > 0 ? (
        <Section title={m.editor_details_fields()} testId="details-fields">
          {fields.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              value={data[field.key]}
              onChange={(value) => onChange(field.key, value)}
              error={errors[field.key]}
              siteId={siteId}
              organizationId={organizationId}
            />
          ))}
        </Section>
      ) : null}

      <Section title={m.editor_status()} testId="details-status">
        <StatusBlock
          entry={entry}
          live={live}
          isNew={isNew}
          canManage={canManage}
          onCancelSchedule={onCancelSchedule}
        />
      </Section>

      <Section title={m.editor_details_history()} testId="details-history">
        {isNew ? (
          <p className="text-callout text-text-muted">{m.editor_history_after_first_save()}</p>
        ) : (
          <EntryHistory
            revisions={revisions}
            loading={revisionsLoading}
            error={revisionsError}
            onRetry={onRetryRevisions}
            canManage={canManage}
            onRestore={onRestore}
          />
        )}
      </Section>
    </div>
  )
}

/** Address preview with the slug editable inline (mono). */
function SlugEditor({
  field,
  value,
  onChange,
  error,
  host,
  routePattern,
  showReset,
  onReset,
}: {
  field: Field
  value: unknown
  onChange: (value: string) => void
  error?: string
  host: string
  routePattern: string
  showReset: boolean
  onReset: () => void
}) {
  const id = `field-${field.key}`
  const [before, after = ''] = routePattern.includes('$slug')
    ? routePattern.split('$slug')
    : [`${routePattern.replace(/\/$/, '')}/`, '']
  return (
    <div className="grid gap-1.5" data-field={field.key} data-invalid={error ? 'true' : undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] leading-[18px] font-medium text-text-primary">
          {field.label}
        </label>
        {showReset ? (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-caption text-text-accent hover:underline"
            data-testid="slug-reset"
          >
            <ArrowCounterClockwise className="size-3" />
            {m.editor_slug_reset()}
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          'flex h-9 min-w-0 items-center rounded-control border bg-background-surface pr-2 pl-3 font-mono text-[12.5px]',
          'transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft',
          error ? 'border-border-error' : 'border-border-strong',
        )}
      >
        <span className="max-w-[55%] shrink-0 truncate text-text-muted" title={`${host}${before}`}>
          {host}
          {before}
        </span>
        <input
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted"
          placeholder="my-page"
        />
        {after ? <span className="shrink-0 text-text-muted">{after}</span> : null}
      </div>
      {error ? (
        <p className="text-callout text-text-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-caption font-normal text-text-muted">{m.editor_slug_rules()}</p>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <dt className="text-caption font-normal text-text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 truncate text-callout text-text-secondary">
        {children}
      </dd>
    </div>
  )
}

function StatusBlock({
  entry,
  live,
  isNew,
  canManage,
  onCancelSchedule,
}: {
  entry: EntryRecord | null
  live: ReleaseStatusData['live'] | undefined
  isNew: boolean
  canManage: boolean
  onCancelSchedule: () => void
}) {
  if (isNew || !entry) {
    return (
      <div className="grid gap-2">
        <EntryPill
          entry={{ status: 'draft', updatedAt: new Date(0) }}
          live={live}
          long
        />
        <p className="text-callout text-text-muted">{m.editor_status_new_hint()}</p>
      </div>
    )
  }
  const scheduledLabel = entry.scheduledAt
    ? new Intl.DateTimeFormat(getLocale(), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: entry.scheduleTimezone ?? undefined,
      }).format(new Date(entry.scheduledAt))
    : null
  return (
    <div className="grid gap-3">
      <EntryPill entry={entry} live={live} long testId="details-entry-status" />
      {entry.status === 'scheduled' && scheduledLabel ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-callout text-text-secondary">
          <span>
            {m.editor_scheduled_line({
              when: scheduledLabel,
              zone: (entry.scheduleTimezone ?? '').replaceAll('_', ' '),
            })}
          </span>
          <span aria-hidden="true">·</span>
          <Hint label={canManage ? '' : editorPublishReason()} wrapDisabled={!canManage}>
            <button
              type="button"
              disabled={!canManage}
              onClick={onCancelSchedule}
              className="inline-flex items-center gap-1 font-medium text-text-accent hover:underline disabled:text-text-disabled disabled:no-underline"
              data-testid="status-cancel-schedule"
            >
              <CalendarX className="size-3.5" />
              {m.editor_cancel()}
            </button>
          </Hint>
        </p>
      ) : null}
      <dl className="grid gap-1 border-t border-border-default pt-3">
        <Row label={m.editor_created()}>
          <span title={formatDateTime(entry.createdAt)}>
            <RelativeTime value={entry.createdAt} />
          </span>
        </Row>
        <Row label={m.editor_updated()}>
          <RelativeTime value={entry.updatedAt} />
        </Row>
        <Row label={m.editor_marked_ready_at()}>
          {entry.publishedAt ? <RelativeTime value={entry.publishedAt} /> : m.editor_never()}
        </Row>
        <Row label={m.editor_author()}>
          <UserAvatar name={entry.createdByName ?? m.editor_unknown_author()} size="xs" />
          <span className="truncate">{entry.createdByName?.trim() || m.editor_unknown_author()}</span>
        </Row>
        <Row label={m.editor_entry_id()}>
          <span className="truncate font-mono text-[11.5px] text-text-muted" title={entry.id}>
            {entry.id.slice(0, 8)}
          </span>
          <CopyButton
            value={entry.id}
            size="icon-xs"
            label={undefined}
            data-testid="copy-entry-id"
            aria-label={m.editor_copy_id()}
          />
        </Row>
      </dl>
    </div>
  )
}
