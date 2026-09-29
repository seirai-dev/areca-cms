import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { QueryError } from '#/components/ui/query-error'
import { RelativeTime, absoluteTimeLabel } from '#/components/ui/timeline'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { Surface } from '#/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { EntryData, EntryStatus, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { Check, Copy } from '@phosphor-icons/react'

import { CollectionField } from './fields'
import { EntryStatusBadge } from './status-badge'
import { formatDateTime, shortId } from './utils'
import type { FieldErrorMap } from './utils'

export type InspectorTab = 'fields' | 'details' | 'revisions'

type RevisionRecord = {
  id: string
  createdAt: string | Date
  note: string | null
  createdByName?: string | null
}

type EntryDetails = {
  id: string
  createdAt: string | Date
  updatedAt: string | Date
  publishedAt: string | Date | null
  scheduledAt: string | Date | null
  createdBy?: string | null
  createdByName?: string | null
  updatedByName?: string | null
} | null

/**
 * Right-hand panel of the editor: the structured fields, the entry's own
 * metadata, and its revision history. The panel body cross-fades between
 * segments (skipped under reduced motion).
 */
export function EntryInspector({
  tab,
  onTabChange,
  fields,
  data,
  errors,
  onChange,
  siteId,
  organizationId,
  status,
  entry,
  revisions,
  revisionsLoading,
  revisionsError,
  onRetryRevisions,
  onRestore,
  canManage,
  isNew,
  className,
}: {
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  fields: Field[]
  data: EntryData
  errors: FieldErrorMap
  onChange: (key: string, value: unknown) => void
  siteId: string
  organizationId: string
  status: EntryStatus | 'unsaved'
  entry: EntryDetails
  revisions: RevisionRecord[]
  revisionsLoading: boolean
  revisionsError: unknown
  onRetryRevisions: () => void
  onRestore: (revisionId: string) => void
  canManage: boolean
  isNew: boolean
  className?: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <Surface
      className={cn('gap-4 p-4', className)}
      aria-label={m.editor_entry_details()}
    >
      <Tabs
        value={tab}
        onValueChange={(next) => onTabChange(next as InspectorTab)}
        className="gap-4"
      >
        <TabsList variant="segmented" className="w-full">
          <TabsTrigger value="fields">{m.editor_fields()}</TabsTrigger>
          <TabsTrigger value="details">{m.editor_details()}</TabsTrigger>
          <TabsTrigger value="revisions" disabled={isNew}>
            {m.editor_revisions()}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fields">
          <Segment id="fields" reduceMotion={reduceMotion}>
            {fields.length === 0 ? (
              <p className="text-ds-body-sm text-text-muted">
                {m.editor_panel_empty()}
              </p>
            ) : (
              <div className="grid gap-5">
                {fields.map((field) => (
                  <CollectionField
                    key={field.key}
                    field={field}
                    value={data[field.key]}
                    onChange={(value) => onChange(field.key, value)}
                    error={errors[field.key]}
                    siteId={siteId}
                    organizationId={organizationId}
                  />
                ))}
              </div>
            )}
          </Segment>
        </TabsContent>

        <TabsContent value="details">
          <Segment id="details" reduceMotion={reduceMotion}>
            <dl className="grid gap-3">
              <Row label={m.editor_status()}>
                <EntryStatusBadge status={status} />
              </Row>
              {entry ? (
                <>
                  <Row label={m.editor_created()}>
                    {formatDateTime(entry.createdAt)}
                  </Row>
                  <Row label={m.editor_updated()}>
                    <RelativeTime value={entry.updatedAt} />
                  </Row>
                  <Row label={m.editor_published()}>
                    {entry.publishedAt
                      ? formatDateTime(entry.publishedAt)
                      : m.editor_never()}
                  </Row>
                  {entry.scheduledAt ? (
                    <Row label={m.editor_scheduled_for()}>
                      {formatDateTime(entry.scheduledAt)}
                    </Row>
                  ) : null}
                  <Row label={m.editor_author()}>
                    <Person name={entry.createdByName} />
                  </Row>
                  <Row label={m.editor_entry_id()}>
                    <CopyId id={entry.id} />
                  </Row>
                </>
              ) : (
                <p className="text-ds-body-sm text-text-muted">
                  {m.editor_save_draft_to_enable()}
                </p>
              )}
            </dl>
          </Segment>
        </TabsContent>

        <TabsContent value="revisions">
          <Segment id="revisions" reduceMotion={reduceMotion}>
            {revisionsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : revisionsError ? (
              <QueryError
                error={revisionsError}
                title={m.editor_could_not_load_revisions()}
                onRetry={onRetryRevisions}
              />
            ) : revisions.length === 0 ? (
              <p className="text-ds-body-sm text-text-muted">
                {m.editor_no_revisions_yet()}
              </p>
            ) : (
              <ol className="grid">
                {revisions.map((revision, index) => (
                  <li
                    key={revision.id}
                    className="flex items-center justify-between gap-2 border-b border-border-subtle py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-ds-body-sm text-text-primary"
                        title={absoluteTimeLabel(revision.createdAt)}
                      >
                        <RelativeTime value={revision.createdAt} />
                        {index === 0 ? (
                          <span className="ml-2 text-ds-body-xs text-text-muted">
                            {m.editor_current()}
                          </span>
                        ) : null}
                      </p>
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-ds-body-xs text-text-muted">
                        <Person name={revision.createdByName} size="xs" />
                        {revision.note ? <span>{revision.note}</span> : null}
                      </p>
                    </div>
                    {canManage ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => onRestore(revision.id)}
                      >
                        {m.editor_restore()}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Segment>
        </TabsContent>
      </Tabs>
    </Surface>
  )
}

function Segment({
  id,
  reduceMotion,
  children,
}: {
  id: string
  reduceMotion: boolean | null
  children: React.ReactNode
}) {
  if (reduceMotion) return <div>{children}</div>
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
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
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ds-body-xs text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ds-body-sm text-text-primary">
        {children}
      </dd>
    </div>
  )
}

/** Author line: initials avatar plus the person's name. */
function Person({
  name,
  size = 'sm',
}: {
  name: string | null | undefined
  size?: 'xs' | 'sm'
}) {
  const label = name?.trim() || m.editor_unknown_author()
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar
        className={size === 'xs' ? 'size-4 text-[9px]' : 'size-5 text-[10px]'}
      >
        <AvatarFallback>{initials(label)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{label}</span>
    </span>
  )
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return '?'
  return parts.map((part) => part.charAt(0).toUpperCase()).join('')
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      data-testid="copy-entry-id"
      aria-label={m.editor_copy_id()}
      onClick={() => {
        void navigator.clipboard.writeText(id)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex items-center gap-1.5 rounded-control px-1 py-0.5 text-ds-mono-xs text-text-secondary transition-colors hover:bg-surface-state-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
      title={id}
    >
      {shortId(id)}
      {copied ? (
        <Check className="size-3 text-icon-success" />
      ) : (
        <Copy className="size-3 text-icon-muted" />
      )}
      <span className="sr-only">{copied ? m.editor_copied() : ''}</span>
    </button>
  )
}
