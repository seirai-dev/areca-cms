import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import { QueryError } from '#/components/query-error'
import { formatRelativeTime } from '#/lib/relative-time'
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
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { useMeasuredHeight } from '#/hooks/use-measured-height'
import type { EntryData, EntryStatus, Field } from '#/lib/types'
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
import { ArrowLeft } from '@phosphor-icons/react'

import { EntryCanvas } from './canvas'
import { EditorToolbar } from './editor-toolbar'
import { EntryInspector } from './inspector'
import type { InspectorTab } from './inspector'
import { queryKeys } from './query-keys'
import { EntryStatusBadge } from './status-badge'
import {
  browserTimezone,
  errorMessage,
  fieldErrorsFromUnknown,
  firstTextField,
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
  createdBy?: string | null
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

export function EntryEditor({
  siteId,
  siteName,
  collectionKey,
  collectionLabel,
  fields,
  organizationId,
  canManage,
  entryId,
}: {
  siteId: string
  siteName: string
  collectionKey: string
  collectionLabel: string
  fields: Field[]
  organizationId: string
  canManage: boolean
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
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('fields')
  const [inspectorOpen, setInspectorOpen] = useState(false)

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
  // The canvas holds the writing surface; every other field lives in the
  // inspector's Fields segment.
  const canvasFields = fields.filter(
    (field) =>
      field.key !== titleField?.key &&
      (field.type === 'richtext' || field.type === 'textarea'),
  )
  const panelFields = fields.filter(
    (field) =>
      field.key !== titleField?.key && !canvasFields.includes(field),
  )

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

  /**
   * Bring the first invalid field into view after a failed save, opening the
   * inspector segment that holds it when it is not on the canvas.
   */
  function revealFirstError(errors: FieldErrorMap) {
    const first = fields.find((field) => errors[field.key])
    if (!first) return
    if (panelFields.includes(first)) {
      setInspectorTab('fields')
    }
    requestAnimationFrame(() => {
      const node = document.querySelector(`[data-field="${first.key}"]`)
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
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
      revealFirstError(parsed.fieldErrors)
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
      revealFirstError(parsed.fieldErrors)
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
      setInspectorTab('fields')
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
      <div className="grid gap-6">
        <Skeleton className="h-14 w-full" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="mx-auto grid w-full max-w-[760px] gap-6">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-96 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
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

  const savedLabel = isNew
    ? canManage
      ? m.editor_not_saved_yet_publish_hint()
      : m.editor_not_saved_yet()
    : entry
      ? m.editor_saved_relative({ time: formatRelativeTime(entry.updatedAt) })
      : m.editor_all_changes_saved()

  const renderInspector = (className?: string) => (
    <EntryInspector
      className={className}
      tab={inspectorTab}
      onTabChange={setInspectorTab}
      fields={panelFields}
      data={data}
      errors={fieldErrors}
      onChange={updateField}
      siteId={siteId}
      organizationId={organizationId}
      status={persistedStatus}
      entry={entry}
      revisions={revisions}
      revisionsLoading={revisionsQuery.isLoading}
      revisionsError={revisionsQuery.isError ? revisionsQuery.error : null}
      onRetryRevisions={() => void revisionsQuery.refetch()}
      onRestore={setRestoreId}
      canManage={canManage}
      isNew={isNew}
    />
  )

  return (
    <div
      data-testid="entry-editor"
      data-ready={actionsReady ? 'true' : 'false'}
      data-dirty={dirty ? 'true' : 'false'}
      style={
        {
          '--rich-text-toolbar-top': `calc(var(--navbar-height) + ${barHeight}px)`,
        } as React.CSSProperties
      }
    >
      <EditorToolbar
        ref={setBarEl}
        siteId={siteId}
        siteName={siteName}
        collectionKey={collectionKey}
        collectionLabel={collectionLabel}
        title={heading}
        statusBadge={
          <EntryStatusBadge status={persistedStatus} testId="entry-status" />
        }
        saving={saving}
        dirty={dirty}
        isNew={isNew}
        savedLabel={savedLabel}
        canManage={canManage}
        actionsReady={actionsReady}
        publishPending={anyActionPending}
        scheduled={entry?.status === 'scheduled'}
        canUnpublish={entry?.status === 'published'}
        canArchive={entry?.status !== 'archived'}
        previewUrl={previewUrl}
        onSave={() => save()}
        onPublish={() => publishMutation.mutate()}
        onSchedule={() => {
          setScheduleAt(toDatetimeLocalValue(new Date()))
          setScheduleTz(browserTimezone())
          setScheduleOpen(true)
        }}
        onCancelSchedule={() => cancelScheduleMutation.mutate()}
        onUnpublish={() => unpublishMutation.mutate()}
        onArchive={() => archiveMutation.mutate()}
        onDelete={() => setDeleteOpen(true)}
        onOpenDetails={() => setInspectorOpen(true)}
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <EntryCanvas
            titleField={titleField}
            canvasFields={canvasFields}
            data={data}
            errors={fieldErrors}
            onChange={updateField}
            siteId={siteId}
            organizationId={organizationId}
          />
        </div>

        <aside
          className="hidden self-start lg:sticky lg:block"
          style={{ top: `calc(var(--navbar-height) + ${barHeight}px + 1.5rem)` }}
        >
          {renderInspector()}
        </aside>
      </div>

      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <SheetContent side="right" size="sm" className="lg:hidden">
          <SheetHeader>
            <SheetTitle>{m.editor_entry_details()}</SheetTitle>
          </SheetHeader>
          <SheetBody className="p-4">
            {renderInspector('border-0 bg-transparent p-0')}
          </SheetBody>
        </SheetContent>
      </Sheet>

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
