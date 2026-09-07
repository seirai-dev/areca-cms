import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '#/components/confirm-dialog'
import { PageHeader } from '#/components/page-header'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { EntryData, EntryStatus, Field } from '#/lib/types'
import {
  archiveEntryFn,
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
  type FieldErrorMap,
} from './utils'

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
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function invalidateEntry(id: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.entry(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.revisions(id) }),
      queryClient.invalidateQueries({ queryKey: ['entries', siteId, collectionKey] }),
    ])
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = payloadFromData(data)
      if (resolvedId) {
        return updateDraftFn({ data: { id: resolvedId, data: payload } })
      }
      return createEntryFn({
        data: { siteId, collectionKey, data: payload },
      })
    },
    onSuccess: async (saved) => {
      setFormError(null)
      setFieldErrors({})
      setCreatedId(saved.id)
      const next = initialEntryData(fields, saved.draftData as EntryData)
      setData(next)
      setSavedSnapshot(JSON.stringify(next))
      toast.success('Draft saved')
      await invalidateEntry(saved.id)
      if (!entryId) {
        await navigate({
          to: '/sites/$siteId/c/$collectionKey/$entryId',
          params: { siteId, collectionKey, entryId: saved.id },
        })
      }
    },
    onError: (error) => {
      const parsed = fieldErrorsFromUnknown(error)
      setFieldErrors(parsed.fieldErrors)
      setFormError(parsed.formError ?? errorMessage(error, 'Could not save'))
    },
  })

  const publishMutation = useMutation({
    mutationFn: () => publishEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success('Published. Remember to Publish site to deploy.', {
        action: {
          label: 'Publish site',
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
      toast.error(parsed.formError ?? errorMessage(error, 'Could not publish'))
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: () => unpublishEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success('Unpublished')
      await invalidateEntry(resolvedId!)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not unpublish')),
  })

  const archiveMutation = useMutation({
    mutationFn: () => archiveEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success('Archived')
      await invalidateEntry(resolvedId!)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not archive')),
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
      toast.success('Scheduled')
      await invalidateEntry(resolvedId!)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not schedule')),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteEntryFn({ data: { id: resolvedId! } }),
    onSuccess: async () => {
      toast.success('Deleted')
      await queryClient.invalidateQueries({
        queryKey: ['entries', siteId, collectionKey],
      })
      await navigate({
        to: '/sites/$siteId/c/$collectionKey',
        params: { siteId, collectionKey },
      })
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not delete')),
  })

  const restoreMutation = useMutation({
    mutationFn: (revisionId: string) =>
      restoreRevisionFn({ data: { entryId: resolvedId!, revisionId } }),
    onSuccess: async () => {
      setRestoreId(null)
      setEditorTab('edit')
      toast.success('Revision restored')
      await invalidateEntry(resolvedId!)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not restore')),
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
    if (isNew) return 'New entry'
    return entry?.slug ?? 'Entry'
  }, [data, entry?.slug, isNew, titleField])

  if (
    entryId &&
    (entryQuery.isLoading || !entry || hydratedId !== entryId)
  ) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (entryId && entryQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Entry not found.</AlertDescription>
      </Alert>
    )
  }

  const revisions = (revisionsQuery.data ?? []) as RevisionRecord[]
  const actionsReady =
    Boolean(entry) &&
    !saveMutation.isPending &&
    !(entryQuery.isFetching && entry?.status !== 'scheduled')
  const previewUrl = previewQuery.data?.url
  const persistedStatus = entry?.status ?? 'unsaved'

  return (
    <div
      className="grid gap-6"
      data-testid="entry-editor"
      data-ready={actionsReady ? 'true' : 'false'}
      data-dirty={dirty ? 'true' : 'false'}
    >
      <PageHeader
        title={heading}
        description={collectionLabel}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <EntryStatusBadge status={persistedStatus} testId="entry-status" />
            <Button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="save-draft"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            {previewUrl ? (
              <Button asChild variant="outline">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="preview-entry"
                >
                  Preview
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled
                data-testid="preview-entry"
              >
                Preview
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" data-testid="publish-menu">
                  Publish
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!actionsReady || publishMutation.isPending}
                  data-testid="publish-now"
                  onSelect={() => publishMutation.mutate()}
                >
                  Publish now
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
                  Schedule…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!actionsReady || entry?.status !== 'published'}
                  onSelect={() => unpublishMutation.mutate()}
                >
                  Unpublish
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!actionsReady || entry?.status === 'archived'}
                  onSelect={() => archiveMutation.mutate()}
                >
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!actionsReady}
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {entry ? (
        <p className="text-sm text-muted-foreground">
          Updated {formatDateTime(entry.updatedAt)}
          {entry.publishedAt ? ` · Published ${formatDateTime(entry.publishedAt)}` : ''}
          {entry.scheduledAt ? ` · Scheduled ${formatDateTime(entry.scheduledAt)}` : ''}
        </p>
      ) : null}

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={editorTab} onValueChange={setEditorTab}>
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="revisions" disabled={isNew}>
            Revisions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="edit" className="grid gap-4 pt-4">
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
        <TabsContent value="revisions" className="pt-4">
          {revisionsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revisions yet.</p>
          ) : (
            <ul className="grid gap-2">
              {revisions.map((revision) => (
                <li
                  key={revision.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {formatDateTime(revision.createdAt)}
                    </p>
                    {revision.note ? (
                      <p className="text-xs text-muted-foreground">{revision.note}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setRestoreId(revision.id)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <p className="text-sm">
        <Link
          to="/sites/$siteId/c/$collectionKey"
          params={{ siteId, collectionKey }}
          className="underline"
        >
          Back to {collectionLabel}
        </Link>
      </p>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule publish</DialogTitle>
            <DialogDescription>
              Choose when this entry should become published.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              type="datetime-local"
              data-testid="schedule-at"
              value={scheduleAt}
              onChange={(event) => setScheduleAt(event.target.value)}
            />
            <Select value={scheduleTz} onValueChange={setScheduleTz}>
              <SelectTrigger className="w-full">
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
          <DialogFooter>
            <Button
              type="button"
              data-testid="schedule-confirm"
              disabled={!scheduleAt || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate()}
            >
              {scheduleMutation.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete entry?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteMutation.mutateAsync()
        }}
      />

      <ConfirmDialog
        open={restoreId !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreId(null)
        }}
        title="Restore revision?"
        description="The current draft will be replaced with this revision."
        confirmLabel="Restore"
        onConfirm={async () => {
          if (restoreId) await restoreMutation.mutateAsync(restoreId)
        }}
      />
    </div>
  )
}
