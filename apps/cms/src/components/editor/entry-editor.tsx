import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  History,
  Loader2,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import { QueryError } from '#/components/query-error'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { useMeasuredHeight } from '#/hooks/use-measured-height'
import type { EntryData, EntryStatus, Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import {
  archiveEntryFn,
  cancelScheduleFn,
  createEntryFn,
  deleteEntryFn,
  getEntryFn,
  getPreviewUrlFn,
  listRevisionsFn,
  publishEntryFn,
  restoreRevisionFn,
  scheduleEntryFn,
  unpublishEntryFn,
  updateDraftFn,
} from '#/server/fn/content'

import { CollectionField } from './fields'
import { queryKeys } from './query-keys'
import { EntryStatusBadge } from './status-badge'
import {
  browserTimezone,
  errorMessage,
  fieldErrorsFromUnknown,
  firstTextField,
  formatDateTime,
  initialEntryData,
  slugify,
  timezoneOptions,
  toDatetimeLocalValue,
} from './utils'
import type { FieldErrorMap } from './utils'

type EntryRecord = {
  id: string
  slug: string
  status: EntryStatus
  draftData: EntryData
  scheduledAt: string | Date | null
  publishedAt: string | Date | null
  createdAt: string | Date
  updatedAt: string | Date
}

type RevisionRecord = {
  id: string
  createdAt: string | Date
  note: string | null
}

function payloadFromData(data: EntryData) {
  const next: EntryData = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    next[key] = value
  }
  return next
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function EntryEditor({
  siteId,
  collectionKey,
  collectionLabel,
  fields,
  organizationId,
  entryId,
}: {
  siteId: string
  collectionKey: string
  collectionLabel: string
  fields: Field[]
  organizationId: string
  entryId?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createdId, setCreatedId] = useState<string | undefined>(entryId)
  const resolvedId = entryId ?? createdId
  const isNew = !resolvedId

  const entryQuery = useQuery({
    queryKey: queryKeys.entry(resolvedId ?? 'new'),
    queryFn: () => getEntryFn({ data: { id: resolvedId! } }),
    enabled: Boolean(resolvedId),
    refetchInterval: (query) => {
      const data = query.state.data as EntryRecord | undefined
      return data?.status === 'scheduled' ? 2000 : false
    },
  })

  const revisionsQuery = useQuery({
    queryKey: queryKeys.revisions(resolvedId ?? ''),
    queryFn: () => listRevisionsFn({ data: { entryId: resolvedId! } }),
    enabled: Boolean(resolvedId),
  })

  const [data, setData] = useState<EntryData>(() => initialEntryData(fields))
  const [hydratedId, setHydratedId] = useState<string | undefined>(undefined)
  const [slugManual, setSlugManual] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState<string>(
    JSON.stringify(initialEntryData(fields)),
  )
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduleTz, setScheduleTz] = useState(browserTimezone)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [editorTab, setEditorTab] = useState('edit')

  const entry = (entryQuery.data ?? null) as EntryRecord | null

  useEffect(() => {
    if (!entry) return
    const next = initialEntryData(fields, entry.draftData)
    setData(next)
    setSavedSnapshot(JSON.stringify(next))
    setSlugManual(true)
    setHydratedId(entry.id)
  }, [entry, fields])

  const dirty = JSON.stringify(data) !== savedSnapshot
  const titleField = firstTextField(fields)
  const slugField = fields.find((field) => field.type === 'slug')

  // Refs so event handlers and the navigation blocker see the latest values.
  const dataRef = useRef(data)
  dataRef.current = data
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const bypassBlockerRef = useRef(false)

  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !bypassBlockerRef.current,
    enableBeforeUnload: () => dirtyRef.current && !bypassBlockerRef.current,
    withResolver: true,
  })

  function updateField(key: string, value: unknown) {
    setData((prev) => {
      const next = { ...prev, [key]: value }
      if (
        !slugManual &&
        slugField &&
        titleField &&
        key === titleField.key &&
        typeof value === 'string'
      ) {
        next[slugField.key] = slugify(value)
      }
      return next
    })
    if (slugField && key === slugField.key) setSlugManual(true)
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function invalidateEntry(id: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.entry(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.revisions(id) }),
      queryClient.invalidateQueries({
        queryKey: ['entries', siteId, collectionKey],
      }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = payloadFromData(dataRef.current)
      const submitted = JSON.stringify(dataRef.current)
      const saved = resolvedId
        ? await updateDraftFn({ data: { id: resolvedId, data: payload } })
        : await createEntryFn({
            data: { siteId, collectionKey, data: payload },
          })
      return { saved, submitted }
    },
    onSuccess: async ({ saved, submitted }) => {
      setFormError(null)
      setFieldErrors({})
      setCreatedId(saved.id)
      const next = initialEntryData(fields, saved.draftData)
      const serverJson = JSON.stringify(next)
      // Only replace local state if nothing was typed while the save was in
      // flight; otherwise keep the user's edits and just move the baseline.
      if (JSON.stringify(dataRef.current) === submitted) {
        setData(next)
      }
      setSavedSnapshot(serverJson)
      toast.success(m.editor_draft_saved())
      await invalidateEntry(saved.id)
      if (!entryId) {
        bypassBlockerRef.current = true
        await navigate({
          to: '/sites/$siteId/c/$collectionKey/$entryId',
          params: { siteId, collectionKey, entryId: saved.id },
          replace: true,
        })
      }
    },
    onError: (error) => {
      const parsed = fieldErrorsFromUnknown(error)
      setFieldErrors(parsed.fieldErrors)
      setFormError(
        parsed.formError ?? errorMessage(error, m.editor_could_not_save()),
      )
    },
  })

  const { mutate: save, isPending: saving } = saveMutation

  // Cmd/Ctrl+S saves the draft.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!saving) save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, saving])

  const publishMutation = useMutation({
    mutationFn: () => publishEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success(m.editor_entry_published(), {
        description: m.editor_entry_published_description(),
        action: {
          label: m.editor_go_to_site(),
          onClick: () => {
            void navigate({ to: '/sites/$siteId', params: { siteId } })
          },
        },
      })
      await invalidateEntry(resolvedId!)
    },
    onError: (error) => {
      const parsed = fieldErrorsFromUnknown(error)
      setFieldErrors(parsed.fieldErrors)
      const message =
        parsed.formError ?? errorMessage(error, m.editor_could_not_publish())
      setFormError(message)
      toast.error(message)
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: () => unpublishEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success(m.editor_entry_unpublished())
      await invalidateEntry(resolvedId!)
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_unpublish())),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success(m.editor_entry_archived())
      await invalidateEntry(resolvedId!)
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_archive())),
  })

  const scheduleMutation = useMutation({
    mutationFn: () =>
      scheduleEntryFn({
        data: {
          id: resolvedId!,
          scheduledAt: new Date(scheduleAt).toISOString(),
          timezone: scheduleTz,
        },
      }),
    onSuccess: async () => {
      setScheduleOpen(false)
      toast.success(m.editor_publish_scheduled())
      await invalidateEntry(resolvedId!)
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_schedule())),
  })

  const cancelScheduleMutation = useMutation({
    mutationFn: () => cancelScheduleFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success(m.editor_schedule_cancelled())
      await invalidateEntry(resolvedId!)
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_cancel_schedule())),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success(m.editor_entry_deleted())
      await queryClient.invalidateQueries({
        queryKey: ['entries', siteId, collectionKey],
      })
      bypassBlockerRef.current = true
      await navigate({
        to: '/sites/$siteId/c/$collectionKey',
        params: { siteId, collectionKey },
      })
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_delete())),
  })

  const restoreMutation = useMutation({
    mutationFn: (revisionId: string) =>
      restoreRevisionFn({ data: { entryId: resolvedId!, revisionId } }),
    onSuccess: async () => {
      setRestoreId(null)
      setEditorTab('edit')
      toast.success(m.editor_revision_restored())
      await invalidateEntry(resolvedId!)
    },
    onError: (error) =>
      toast.error(errorMessage(error, m.editor_could_not_restore())),
  })

  const previewQuery = useQuery({
    queryKey: queryKeys.previewUrl(siteId, collectionKey, entry?.slug ?? ''),
    queryFn: () =>
      getPreviewUrlFn({
        data: {
          siteId,
          collection: collectionKey,
          slug: entry!.slug,
        },
      }),
    enabled: Boolean(entry?.slug),
  })

  const heading = useMemo(() => {
    const title = titleField ? data[titleField.key] : ''
    if (typeof title === 'string' && title.trim()) return title
    if (isNew) return m.editor_new_entry()
    return entry?.slug ?? m.editor_entry()
  }, [data, entry?.slug, isNew, titleField, getLocale()])

  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null)
  const barHeight = useMeasuredHeight(barEl)

  if (entryId && entryQuery.isError) {
    return (
      <div className="grid gap-4">
        <QueryError
          error={entryQuery.error}
          title={m.editor_could_not_load_entry()}
          onRetry={() => entryQuery.refetch()}
          retrying={entryQuery.isFetching}
        />
        <Button asChild variant="outline" className="w-fit">
          <Link
            to="/sites/$siteId/c/$collectionKey"
            params={{ siteId, collectionKey }}
          >
            <ArrowLeft />
            {m.editor_back_to({ name: collectionLabel })}
          </Link>
        </Button>
      </div>
    )
  }

  if (entryId && (entryQuery.isLoading || !entry || hydratedId !== entryId)) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    )
  }

  const revisions = (revisionsQuery.data ?? []) as RevisionRecord[]
  const actionsReady =
    Boolean(entry) &&
    !saving &&
    !(entryQuery.isFetching && entry?.status !== 'scheduled')
  const previewUrl = previewQuery.data?.url
  const persistedStatus = entry?.status ?? 'unsaved'
  const anyActionPending =
    publishMutation.isPending ||
    unpublishMutation.isPending ||
    archiveMutation.isPending ||
    cancelScheduleMutation.isPending

  return (
    <div
      className="grid gap-5"
      data-testid="entry-editor"
      data-ready={actionsReady ? 'true' : 'false'}
      data-dirty={dirty ? 'true' : 'false'}
      style={
        {
          '--rich-text-toolbar-top': `calc(var(--app-header-h) + ${barHeight}px)`,
        } as React.CSSProperties
      }
    >
      <Link
        to="/sites/$siteId/c/$collectionKey"
        params={{ siteId, collectionKey }}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {m.editor_back_to({ name: collectionLabel })}
      </Link>

      {/* Sticky action bar: stays visible while scrolling long forms. */}
      <div
        ref={setBarEl}
        className="sticky top-(--app-header-h) z-20 -mx-4 border-b bg-background px-4 py-3 sm:-mx-6 sm:px-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-xl font-semibold tracking-tight"
              title={heading}
            >
              {heading}
            </h1>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {saving ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  {m.editor_saving()}
                </span>
              ) : dirty ? (
                <span
                  className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
                  data-testid="entry-dirty"
                >
                  <span className="size-1.5 rounded-full bg-current" />
                  {m.editor_unsaved_changes()}
                </span>
              ) : isNew ? (
                <span>{m.editor_not_saved_yet()}</span>
              ) : (
                <span>{m.editor_all_changes_saved()}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EntryStatusBadge status={persistedStatus} testId="entry-status" />
            <Button
              type="button"
              onClick={() => save()}
              disabled={saving}
              data-testid="save-draft"
              title={m.editor_save_draft_shortcut({
                shortcut: `${isMac ? '⌘' : 'Ctrl+'}S`,
              })}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? m.editor_saving() : m.editor_save_draft()}
            </Button>
            {previewUrl ? (
              <Button asChild variant="outline">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="preview-entry"
                >
                  <ExternalLink />
                  {m.editor_preview()}
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled
                data-testid="preview-entry"
                title={isNew ? m.editor_preview_save_first() : undefined}
              >
                <ExternalLink />
                {m.editor_preview()}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="publish-menu"
                  disabled={isNew}
                  title={isNew ? m.editor_save_draft_first() : undefined}
                >
                  {anyActionPending ? (
                    <Loader2 className="animate-spin" />
                  ) : null}
                  {m.editor_publish()}
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {dirty
                    ? m.editor_publish_save_first_hint()
                    : m.editor_publish_makes_live_hint()}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!actionsReady || publishMutation.isPending}
                  data-testid="publish-now"
                  onSelect={() => publishMutation.mutate()}
                >
                  {m.editor_publish_now()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!actionsReady}
                  data-testid="schedule-entry"
                  onSelect={() => {
                    setScheduleAt(toDatetimeLocalValue(new Date()))
                    setScheduleTz(browserTimezone())
                    setScheduleOpen(true)
                  }}
                >
                  <CalendarClock />
                  {m.editor_schedule_ellipsis()}
                </DropdownMenuItem>
                {entry?.status === 'scheduled' ? (
                  <DropdownMenuItem
                    disabled={!actionsReady || cancelScheduleMutation.isPending}
                    data-testid="cancel-schedule"
                    onSelect={() => cancelScheduleMutation.mutate()}
                  >
                    {m.editor_cancel_schedule()}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!actionsReady || entry?.status !== 'published'}
                  onSelect={() => unpublishMutation.mutate()}
                >
                  {m.editor_unpublish()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!actionsReady || entry?.status === 'archived'}
                  onSelect={() => archiveMutation.mutate()}
                >
                  {m.editor_archive()}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!actionsReady}
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  {m.editor_delete_ellipsis()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={editorTab} onValueChange={setEditorTab}>
            <TabsList>
              <TabsTrigger value="edit">{m.editor_edit()}</TabsTrigger>
              <TabsTrigger value="revisions" disabled={isNew}>
                <History />
                {m.editor_revisions()}
                {revisions.length > 0 ? (
                  <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                    {revisions.length}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="edit" className="grid gap-5 pt-3">
              {fields.map((field) => (
                <CollectionField
                  key={field.key}
                  field={field}
                  value={data[field.key]}
                  onChange={(value) => updateField(field.key, value)}
                  error={fieldErrors[field.key]}
                  siteId={siteId}
                  organizationId={organizationId}
                />
              ))}
            </TabsContent>
            <TabsContent value="revisions" className="pt-3">
              {revisionsQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : revisionsQuery.isError ? (
                <QueryError
                  error={revisionsQuery.error}
                  title={m.editor_could_not_load_revisions()}
                  onRetry={() => revisionsQuery.refetch()}
                  retrying={revisionsQuery.isFetching}
                />
              ) : revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {m.editor_no_revisions_yet()}
                </p>
              ) : (
                <ul className="grid gap-2">
                  {revisions.map((revision, index) => (
                    <li
                      key={revision.id}
                      className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {formatDateTime(revision.createdAt)}
                          {index === 0 ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {m.editor_latest()}
                            </span>
                          ) : null}
                        </p>
                        {revision.note ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {revision.note}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRestoreId(revision.id)}
                      >
                        {m.editor_restore()}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <aside
          className="grid gap-4 lg:sticky"
          style={{ top: `calc(var(--app-header-h) + ${barHeight}px + 1.5rem)` }}
          aria-label={m.editor_entry_details()}
        >
          <div className="border-t pt-4">
            <h2 className="mb-3 text-sm font-semibold">{m.editor_details()}</h2>
            <dl className="grid gap-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{m.editor_status()}</dt>
                <dd>
                  <EntryStatusBadge status={persistedStatus} />
                </dd>
              </div>
              {entry ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {m.editor_updated()}
                    </dt>
                    <dd className="text-right">
                      {formatDateTime(entry.updatedAt)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {m.editor_published()}
                    </dt>
                    <dd className="text-right">
                      {entry.publishedAt
                        ? formatDateTime(entry.publishedAt)
                        : m.editor_never()}
                    </dd>
                  </div>
                  {entry.scheduledAt ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">
                        {m.editor_status_scheduled()}
                      </dt>
                      <dd className="text-right">
                        {formatDateTime(entry.scheduledAt)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{m.editor_slug()}</dt>
                    <dd
                      className="truncate font-mono text-xs"
                      title={entry.slug}
                    >
                      {entry.slug}
                    </dd>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {m.editor_save_draft_to_enable()}
                </p>
              )}
            </dl>
            {entry?.status === 'scheduled' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                disabled={cancelScheduleMutation.isPending}
                onClick={() => cancelScheduleMutation.mutate()}
              >
                {m.editor_cancel_schedule()}
              </Button>
            ) : null}
          </div>
          <p className={cn('px-1 text-xs text-muted-foreground')}>
            {entry?.status === 'published'
              ? m.editor_published_draft_hint()
              : m.editor_unpublished_draft_hint()}
          </p>
        </aside>
      </div>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.editor_schedule_publish()}</DialogTitle>
            <DialogDescription>
              {m.editor_schedule_publish_description()}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="schedule-at">{m.editor_publish_at()}</Label>
              <Input
                id="schedule-at"
                type="datetime-local"
                data-testid="schedule-at"
                value={scheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="schedule-tz">{m.editor_time_zone()}</Label>
              <Select value={scheduleTz} onValueChange={setScheduleTz}>
                <SelectTrigger className="w-full" id="schedule-tz">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezoneOptions().map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setScheduleOpen(false)}
            >
              {m.editor_cancel()}
            </Button>
            <Button
              type="button"
              data-testid="schedule-confirm"
              disabled={!scheduleAt || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate()}
            >
              {scheduleMutation.isPending
                ? m.editor_scheduling()
                : m.editor_schedule()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={m.editor_delete_entry_title()}
        description={m.editor_delete_entry_description()}
        confirmLabel={m.editor_delete()}
        variant="destructive"
        onConfirm={async () => {
          await deleteMutation.mutateAsync()
        }}
      />

      <ConfirmDialog
        open={restoreId !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreId(null)
        }}
        title={m.editor_restore_revision_title()}
        description={m.editor_restore_revision_description()}
        confirmLabel={m.editor_restore()}
        onConfirm={async () => {
          if (restoreId) await restoreMutation.mutateAsync(restoreId)
        }}
      />

      <AlertDialog open={blocker.status === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.editor_leave_without_saving()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.editor_leave_without_saving_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {m.editor_stay()}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => blocker.proceed?.()}
              data-testid="discard-changes"
            >
              {m.editor_discard_changes()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
