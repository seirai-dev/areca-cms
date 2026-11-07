import * as React from 'react'
import { ArrowCounterClockwise, CalendarX } from '@phosphor-icons/react'

import { formatDateTime, slugify } from '#/lib/content/utils'
import type { FieldErrorMap } from '#/lib/content/utils'
import { UserAvatar } from '#/components/ui/avatar'
import { CopyButton } from '#/components/ui/copy-button'
import { Hint } from '#/components/ui/tooltip'
import { RelativeTime } from '#/components/ui/timeline'
import { EntryPill } from '#/features/collection/entry-pill'
import type { LiveMembership } from '#/features/golive/entry-live-state'
import { editorPublishReason } from '#/features/golive/golive-tray'
import { displayHost } from '#/lib/site-nav'
import type { EntryData, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

import { FieldControl } from './fields/field-control'
import { EntryHistory } from './history'
import { LinkedFrom } from './linked-from'
import { LanguageRing } from './language-ring'
import { languageStateKey } from './language-state'
import type { LocaleSummary } from './language-state'
import type { EntryRecord } from './use-entry-editor'

/** One language in the Status block. */
export type LanguageRow = { summary: LocaleSummary; name: string }

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
    <section
      className={cn('grid grid-cols-[minmax(0,1fr)] gap-2', className)}
      data-testid={testId}
    >
      <h2 className="px-1 text-overline text-text-muted">{title}</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-card border border-border-default bg-background-surface p-4 shadow-card">
        {children}
      </div>
    </section>
  )
}

/**
 * The editor's details panel (brief §3.5): grouped cards — Page (address
 * and slug), Fields (every structured field), SEO & discovery, Status
 * (pill, schedule, dates, author, id) and History.
 */
export function DetailsPanel({
  siteId,
  devSite = false,
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
  entryId,
  onRestore,
  onCancelSchedule,
  seoPanel,
  languageRows,
  onSelectLanguage,
  slugPlaceholder,
  slugHelper,
}: {
  siteId: string
  /** A development environment has no releases: published reads as Ready. */
  devSite?: boolean
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
  /** The entry whose history the panel shows; none until it is saved once. */
  entryId: string | undefined
  live: LiveMembership
  isNew: boolean
  canManage: boolean
  onRestore: (revisionId: string) => void
  onCancelSchedule: () => void
  /** The built-in SEO & discovery block (see `SeoPanel`). */
  seoPanel?: React.ReactNode
  /** Content languages: one row per language in the Status block. */
  languageRows?: LanguageRow[]
  onSelectLanguage?: (code: string) => void
  /** Slug placeholder (the main slug) while a translation has no slug of its own. */
  slugPlaceholder?: string
  /** Helper under the slug, replacing the default rules. */
  slugHelper?: string
}) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-6"
      data-testid="entry-details"
    >
      {slugField ? (
        <Section title={m.editor_details_page()} testId="details-page">
          <SlugEditor
            field={slugField}
            value={data[slugField.key]}
            onChange={(value) => onChange(slugField.key, value)}
            error={errors[slugField.key]}
            host={displayHost(productionUrl)}
            routePattern={routePattern}
            placeholder={slugPlaceholder}
            helper={slugHelper}
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
              devSite={devSite}
              organizationId={organizationId}
            />
          ))}
        </Section>
      ) : null}

      {seoPanel ? (
        <Section title={m.editor_seo_section()} testId="details-seo">
          {seoPanel}
        </Section>
      ) : null}

      <Section title={m.editor_status()} testId="details-status">
        <StatusBlock
          entry={entry}
          live={live}
          devSite={devSite}
          isNew={isNew}
          canManage={canManage}
          onCancelSchedule={onCancelSchedule}
          languageRows={languageRows}
          onSelectLanguage={onSelectLanguage}
        />
      </Section>

      {entryId ? (
        <Section title={m.editor_linked_from()} testId="details-linked-from">
          <LinkedFrom
            siteId={siteId}
            entryId={entryId}
            live={live}
            devSite={devSite}
          />
        </Section>
      ) : null}

      <Section title={m.editor_details_history()} testId="details-history">
        {isNew ? (
          <p className="text-callout text-text-muted">
            {m.editor_history_after_first_save()}
          </p>
        ) : (
          <EntryHistory
            entryId={entryId}
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
  placeholder,
  helper,
}: {
  field: Field
  value: unknown
  onChange: (value: string) => void
  error?: string
  host: string
  routePattern: string
  showReset: boolean
  onReset: () => void
  placeholder?: string
  helper?: string
}) {
  const id = `field-${field.key}`
  const [before, after = ''] = routePattern.includes('$slug')
    ? routePattern.split('$slug')
    : [`${routePattern.replace(/\/$/, '')}/`, '']
  return (
    <div
      className="grid min-w-0 gap-1.5"
      data-field={field.key}
      data-invalid={error ? 'true' : undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[13px] leading-[18px] font-medium text-text-primary"
        >
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
        <span
          className="max-w-[55%] shrink-0 truncate text-text-muted"
          title={`${host}${before}`}
        >
          {host}
          {before}
        </span>
        <input
          id={id}
          size={1}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted"
          placeholder={placeholder ?? m.editor_slug_placeholder()}
        />
        {after ? (
          <span className="shrink-0 text-text-muted">{after}</span>
        ) : null}
      </div>
      {error ? (
        <p className="text-callout text-text-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-caption font-normal text-text-muted">
          {helper ?? m.editor_slug_rules()}
        </p>
      )}
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <dt className="text-caption font-normal text-text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 truncate text-callout text-text-secondary">
        {children}
      </dd>
    </div>
  )
}

/** Language state as words: "Complete", "2 missing", "Not started", "Optional". */
function languageStateText(summary: LocaleSummary): string {
  switch (languageStateKey(summary)) {
    case 'complete':
      return m.editor_language_state_complete()
    case 'not_started':
      return m.editor_language_state_not_started()
    case 'optional':
      return m.editor_language_state_optional()
    case 'missing':
      return m.editor_language_state_missing({
        count: summary.missing.length,
      })
  }
}

function LanguageList({
  rows,
  onSelect,
}: {
  rows: LanguageRow[]
  onSelect?: (code: string) => void
}) {
  return (
    <section
      aria-label={m.editor_language_status_heading()}
      className="grid gap-1.5"
      data-testid="details-languages"
    >
      <h3 className="text-caption font-medium text-text-muted">
        {m.editor_language_status_heading()}
      </h3>
      <ul className="grid gap-0.5">
        {rows.map(({ summary, name }) => (
          <li key={summary.locale}>
            <button
              type="button"
              onClick={() => onSelect?.(summary.locale)}
              className="flex min-h-7 w-full items-center gap-2 rounded-[8px] px-1.5 text-left hover:bg-surface-state-hover"
              data-testid={`details-language-${summary.locale}`}
            >
              <LanguageRing
                state={summary.state}
                fraction={summary.fraction}
                warning={summary.warning}
              />
              <span className="min-w-0 flex-1 truncate text-callout text-text-primary">
                {name}
                {summary.required ? (
                  <span className="ml-1.5 text-caption text-text-muted">
                    {m.editor_language_required_hint()}
                  </span>
                ) : null}
              </span>
              <span
                className={
                  summary.warning
                    ? 'text-caption text-text-warning'
                    : 'text-caption text-text-muted'
                }
              >
                {languageStateText(summary)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StatusBlock({
  entry,
  live,
  devSite,
  isNew,
  canManage,
  onCancelSchedule,
  languageRows,
  onSelectLanguage,
}: {
  entry: EntryRecord | null
  live: LiveMembership
  devSite: boolean
  isNew: boolean
  canManage: boolean
  onCancelSchedule: () => void
  languageRows?: LanguageRow[]
  onSelectLanguage?: (code: string) => void
}) {
  if (isNew || !entry) {
    return (
      <div className="grid gap-2">
        <EntryPill
          entry={{ status: 'draft', updatedAt: new Date(0) }}
          live={live}
          devSite={devSite}
          long
        />
        {languageRows && languageRows.length > 0 ? (
          <LanguageList rows={languageRows} onSelect={onSelectLanguage} />
        ) : null}
        <p className="text-callout text-text-muted">
          {m.editor_status_new_hint()}
        </p>
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
      <EntryPill
        entry={entry}
        live={live}
        devSite={devSite}
        long
        testId="details-entry-status"
      />
      {languageRows && languageRows.length > 0 ? (
        <LanguageList rows={languageRows} onSelect={onSelectLanguage} />
      ) : null}
      {entry.status === 'scheduled' && scheduledLabel ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-callout text-text-secondary">
          <span>
            {m.editor_scheduled_line({
              when: scheduledLabel,
              zone: (entry.scheduleTimezone ?? '').replaceAll('_', ' '),
            })}
          </span>
          <span aria-hidden="true">·</span>
          <Hint
            label={canManage ? '' : editorPublishReason()}
            wrapDisabled={!canManage}
          >
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
          {entry.publishedAt ? (
            <RelativeTime value={entry.publishedAt} />
          ) : (
            m.editor_never()
          )}
        </Row>
        <Row label={m.editor_author()}>
          <UserAvatar
            name={entry.createdByName ?? m.people_deleted_user()}
            size="xs"
          />
          <span className="truncate">
            {entry.createdByName?.trim() || m.people_deleted_user()}
          </span>
        </Row>
        <Row label={m.editor_entry_id()}>
          <span
            className="truncate font-mono text-[11.5px] text-text-muted"
            title={entry.id}
          >
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
