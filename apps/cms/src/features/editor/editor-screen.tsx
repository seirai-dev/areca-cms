import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Stack, WarningCircle } from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'
import { initialEntryData } from '#/lib/content/utils'
import { TOGGLE_DETAILS_EVENT, useShortcut } from '#/components/shell/shortcuts'
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
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Popover, PopoverAnchor, PopoverContent } from '#/components/ui/popover'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { SlideOver } from '#/components/ui/slide-over'
import { entryTransitionName } from '#/features/collection/entry-item'
import {
  entryUiStatus,
  isEditedSinceReady,
} from '#/features/golive/entry-live-state'
import { canGoLive } from '#/features/golive/go-live-gate'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { usePanel } from '#/features/shell/panel'
import { useIsMobile, useMediaQuery } from '#/hooks/use-mobile'
import { canManageSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import type { Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { readEntrySeo, SEO_KEY } from '#/lib/seo'
import { getAiAvailabilityFn } from '#/server/fn/ai'
import { listCollectionsFn, listInboundReferencesFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'

import { AiSeoDialog } from './ai-seo-dialog'

import { DetailsPanel } from './details-panel'
import { EditorCanvas } from './editor-canvas'
import { EditorTopBar } from './editor-top-bar'
import type { PrimaryState } from './editor-top-bar'
import { ScheduledVersion } from './scheduled-version'
import { ScheduleForm } from './schedule-form'
import { SeoPanel, plainTextOf } from './seo-panel'
import { useEntryEditor } from './use-entry-editor'

type CollectionRecord = {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

const DETAILS_KEY = 'areca.editor.details'

/**
 * Editor (brief §3.5), in focus mode: resolves the collection, then renders
 * the entry editor. Omit `entryId` for a new entry.
 */
export function EditorScreen({
  me,
  site,
  collectionKey,
  entryId,
  onCreated,
  onDeleted,
}: {
  me: Me
  site: MeSite
  collectionKey: string
  entryId?: string
  onCreated: (id: string) => Promise<unknown> | void
  onDeleted: () => Promise<unknown> | void
}) {
  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(site.id),
    queryFn: () => listCollectionsFn({ data: { siteId: site.id } }),
  })
  const collection = (
    collectionsQuery.data as CollectionRecord[] | undefined
  )?.find((item) => item.key === collectionKey)

  if (collectionsQuery.isLoading) return <EditorSkeleton />
  if (collectionsQuery.isError) {
    return (
      <QueryError
        title={m.sites_collections_load_error()}
        error={collectionsQuery.error}
        onRetry={() => void collectionsQuery.refetch()}
        retrying={collectionsQuery.isFetching}
      />
    )
  }
  if (!collection) {
    return (
      <EmptyState
        card
        tone="neutral"
        icon={<Stack weight="duotone" />}
        title={m.editor_collection_not_found()}
        description={m.editor_collection_not_found_description()}
        action={
          <Button asChild variant="secondary">
            <Link to="/sites/$siteId" params={{ siteId: site.id }}>
              {m.shell_nav_overview()}
            </Link>
          </Button>
        }
      />
    )
  }

  return (
    <EntryEditorView
      me={me}
      site={site}
      collection={collection}
      entryId={entryId}
      onCreated={onCreated}
      onDeleted={onDeleted}
    />
  )
}

function useDetailsPreference() {
  const [open, setOpen] = React.useState(true)
  React.useEffect(() => {
    try {
      if (localStorage.getItem(DETAILS_KEY) === 'closed') setOpen(false)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  const set = React.useCallback((next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(DETAILS_KEY, next ? 'open' : 'closed')
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  return [open, set] as const
}

function EntryEditorView({
  me,
  site,
  collection,
  entryId: routeEntryId,
  onCreated,
  onDeleted,
}: {
  me: Me
  site: MeSite
  collection: CollectionRecord
  entryId?: string
  onCreated: (id: string) => Promise<unknown> | void
  onDeleted: () => Promise<unknown> | void
}) {
  const siteId = site.id
  const canManage = canManageSite(me, site.organizationId)
  const release = useReleaseStatus(siteId)
  const live = release.liveMembership
  const panel = usePanel()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const mobile = useIsMobile()
  const [panelPref, setPanelPref] = useDetailsPreference()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const detailsOpen = desktop ? panelPref : sheetOpen
  const [previewing, setPreviewing] = React.useState(false)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [restoreId, setRestoreId] = React.useState<string | null>(null)
  const titleRef = React.useRef<HTMLTextAreaElement>(null)
  const [titleVisible, setTitleVisible] = React.useState(true)

  const fields = collection.fields
  const editor = useEntryEditor({
    siteId,
    collectionKey: collection.key,
    fields,
    entryId: routeEntryId,
    onCreated,
    onDeleted,
    onRevealError: (key) => revealField(key),
  })
  const { entry, data, titleField, slugField } = editor
  const inboundQuery = useQuery({
    queryKey: queryKeys.inboundReferences(editor.entryId ?? ''),
    queryFn: () => listInboundReferencesFn({ data: { id: editor.entryId! } }),
    enabled: deleteOpen && Boolean(editor.entryId),
  })
  const inboundTitles = (inboundQuery.data ?? []).map((row) => row.title)
  const [aiOpen, setAiOpen] = React.useState(false)
  const aiQuery = useQuery({
    queryKey: queryKeys.aiAvailability(),
    queryFn: () => getAiAvailabilityFn(),
    staleTime: 30_000,
  })

  const canvasFields = fields.filter(
    (field) =>
      field.key !== titleField?.key &&
      (field.type === 'richtext' || field.type === 'textarea'),
  )
  const panelFields = fields.filter(
    (field) =>
      field.key !== titleField?.key &&
      field.key !== slugField?.key &&
      !canvasFields.includes(field),
  )

  function openDetails() {
    if (desktop) setPanelPref(true)
    else setSheetOpen(true)
  }

  function toggleDetails() {
    if (desktop) setPanelPref(!panelPref)
    else setSheetOpen((value) => !value)
  }

  function revealField(key: string) {
    const inPanel =
      key === slugField?.key ||
      key.startsWith(`${SEO_KEY}.`) ||
      panelFields.some((field) => field.key === key)
    if (inPanel) openDetails()
    const attempt = (tries: number) => {
      const node = document.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(key)}"]`,
      )
      if (!node) {
        if (tries > 0) window.setTimeout(() => attempt(tries - 1), 120)
        return
      }
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      node
        .querySelector<HTMLElement>(
          'input, textarea, [contenteditable="true"], button',
        )
        ?.focus({ preventScroll: true })
    }
    requestAnimationFrame(() => attempt(5))
  }

  React.useEffect(() => {
    const onToggle = () => toggleDetails()
    window.addEventListener(TOGGLE_DETAILS_EVENT, onToggle)
    return () => window.removeEventListener(TOGGLE_DETAILS_EVENT, onToggle)
  })

  useShortcut('mod+s', () => void editor.save())

  // The small title in the top bar fades in once the big one scrolls away.
  React.useEffect(() => {
    const node = titleRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([item]) => setTitleVisible(item.isIntersecting),
      { rootMargin: '-56px 0px 0px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [editor.loading])

  if (routeEntryId && editor.entryQuery.isError && !entry) {
    return (
      <div
        className="mx-auto grid max-w-xl gap-4 py-16"
        data-testid="entry-editor"
        data-ready="false"
      >
        <QueryError
          error={editor.entryQuery.error}
          title={m.editor_could_not_load_entry()}
          onRetry={() => void editor.entryQuery.refetch()}
          retrying={editor.entryQuery.isFetching}
        />
        <Button asChild variant="secondary" className="w-fit">
          <Link
            to="/sites/$siteId/c/$collectionKey"
            params={{ siteId, collectionKey: collection.key }}
          >
            <ArrowLeft />
            {m.editor_back_to({ name: collection.label })}
          </Link>
        </Button>
      </div>
    )
  }

  if (editor.loading) return <EditorSkeleton />

  const title =
    titleField &&
    typeof data[titleField.key] === 'string' &&
    (data[titleField.key] as string).trim()
      ? (data[titleField.key] as string)
      : m.editor_untitled()
  const uiStatus = entry ? entryUiStatus(entry, live) : 'draft'
  const editedSinceReady = entry
    ? isEditedSinceReady({
        status: entry.status,
        updatedAt: entry.updatedAt,
        draftData: initialEntryData(fields, entry.draftData),
        publishedData: entry.publishedData
          ? initialEntryData(fields, entry.publishedData)
          : entry.publishedData,
      })
    : false
  const primary: PrimaryState = editor.isNew
    ? 'new'
    : editor.markable
      ? 'mark'
      : uiStatus === 'ready'
        ? 'ready'
        : uiStatus === 'live'
          ? 'live'
          : 'mark'

  async function goLiveNow() {
    const result = await editor.goLiveNow().catch(() => null)
    if (
      result &&
      typeof result === 'object' &&
      'ok' in result &&
      result.ok === false
    ) {
      panel.open('golive')
    }
  }

  const seo = readEntrySeo(data)
  const slugValue = slugField ? data[slugField.key] : undefined
  const excerptField = fields.find(
    (field) =>
      field.type === 'textarea' &&
      typeof data[field.key] === 'string' &&
      (data[field.key] as string).trim(),
  )
  const bodyField = fields.find((field) => field.type === 'richtext')
  const fallbackDescription = excerptField
    ? (data[excerptField.key] as string)
    : bodyField
      ? plainTextOf(data[bodyField.key]) || null
      : null

  const details = (
    <DetailsPanel
      siteId={siteId}
      organizationId={site.organizationId}
      productionUrl={site.productionUrl}
      routePattern={collection.routePattern}
      fields={panelFields}
      slugField={slugField}
      titleField={titleField}
      data={data}
      errors={editor.fieldErrors}
      onChange={editor.updateField}
      slugManual={editor.slugManual}
      onResetSlug={editor.resetSlugFromTitle}
      entry={entry}
      live={live}
      isNew={editor.isNew}
      canManage={canManage}
      revisions={editor.revisions}
      revisionsLoading={editor.revisionsQuery.isLoading}
      revisionsError={
        editor.revisionsQuery.isError ? editor.revisionsQuery.error : null
      }
      onRetryRevisions={() => void editor.revisionsQuery.refetch()}
      onRestore={setRestoreId}
      onCancelSchedule={editor.cancelSchedule}
      seoPanel={
        <SeoPanel
          seo={seo}
          onChange={(next) => editor.updateField(SEO_KEY, next)}
          errors={editor.fieldErrors}
          organizationId={site.organizationId}
          productionUrl={site.productionUrl}
          routePattern={collection.routePattern}
          slug={typeof slugValue === 'string' ? slugValue : ''}
          entryTitle={
            title === m.editor_untitled()
              ? typeof slugValue === 'string'
                ? slugValue
                : ''
              : title
          }
          fallbackDescription={fallbackDescription}
          aiEnabled={aiQuery.data?.enabled === true}
          onGenerate={() => setAiOpen(true)}
        />
      }
    />
  )

  const scheduleForm = (
    <ScheduleForm
      initialAt={entry?.scheduledAt ? new Date(entry.scheduledAt) : null}
      initialTimeZone={entry?.scheduleTimezone}
      pending={editor.schedulePending}
      onCancel={() => setScheduleOpen(false)}
      onSubmit={async (at, timeZone) => {
        const result = await editor.schedule(at, timeZone).catch(() => null)
        if (result) setScheduleOpen(false)
      }}
    />
  )

  const hasErrors = editor.errorCount > 0 || Boolean(editor.formError)

  return (
    <div
      data-testid="entry-editor"
      data-ready={editor.ready ? 'true' : 'false'}
      data-dirty={editor.dirty ? 'true' : 'false'}
      data-entry-id={editor.entryId}
      style={{ '--editor-bar-h': '56px' } as React.CSSProperties}
      className="-mb-6 min-h-[calc(100dvh-3rem)]"
    >
      <EditorTopBar
        siteId={siteId}
        collectionKey={collection.key}
        collectionLabel={collection.label}
        title={title}
        showTitle={!titleVisible}
        uiStatus={uiStatus}
        backendStatus={entry?.status ?? 'draft'}
        scheduledAt={entry?.scheduledAt}
        editedSinceReady={editedSinceReady}
        saveStatus={editor.status}
        isNew={editor.isNew}
        lastSavedAt={editor.lastSavedAt}
        updatedAt={entry?.updatedAt}
        errorCount={editor.errorCount}
        onSave={() => void editor.save()}
        previewUrl={editor.previewUrl}
        canManage={canManage}
        primary={primary}
        busy={editor.busy}
        primaryPending={editor.markReadyPending || editor.goLiveNowPending}
        scheduled={entry?.status === 'scheduled'}
        canUnpublish={entry?.status === 'published'}
        canArchive={entry?.status !== 'archived'}
        hasRichText={canvasFields.some((field) => field.type === 'richtext')}
        previewing={previewing}
        onTogglePreviewing={() => setPreviewing((value) => !value)}
        onGenerateSeo={
          aiQuery.data?.enabled === true ? () => setAiOpen(true) : undefined
        }
        onMarkReady={editor.markReady}
        onGoLiveNow={() => void goLiveNow()}
        goLiveBlocked={
          !canGoLive({
            canPublish: canManage,
            blockers: release.data?.blockers,
          })
        }
        onSchedule={() => setScheduleOpen(true)}
        onCancelSchedule={editor.cancelSchedule}
        onUnpublish={editor.unpublish}
        onArchive={editor.archive}
        onDelete={() => setDeleteOpen(true)}
        detailsOpen={detailsOpen}
        onToggleDetails={toggleDetails}
        entryId={editor.entryId}
        scheduleAnchor={(node) =>
          mobile ? (
            node
          ) : (
            <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
              <PopoverAnchor asChild>{node}</PopoverAnchor>
              <PopoverContent
                align="end"
                sideOffset={10}
                className="w-[360px] p-5"
                data-testid="schedule-popover"
              >
                <div className="mb-4 grid gap-0.5">
                  <p className="text-headline text-text-primary">
                    {m.editor_schedule_title()}
                  </p>
                  <p className="text-callout text-text-secondary">
                    {m.editor_schedule_description()}
                  </p>
                </div>
                {scheduleForm}
              </PopoverContent>
            </Popover>
          )
        }
      />

      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] items-start gap-10 pb-24',
          desktop && detailsOpen && 'lg:grid-cols-[minmax(0,1fr)_340px]',
        )}
      >
        <section
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 px-1 pt-4 sm:pt-10"
          aria-label={m.editor_canvas_label()}
        >
          {editor.conflict || editor.recoveredDraft ? (
            <div
              role="alert"
              className="mx-auto grid w-full max-w-[720px] gap-3 rounded-card border border-border-error/30 p-4"
            >
              <p>
                {editor.conflict
                  ? m.editor_draft_conflict_notice()
                  : m.editor_draft_recovered_notice()}
              </p>
              <div className="flex flex-wrap gap-4">
                <button
                  type="button"
                  className="underline"
                  onClick={() => void editor.reloadServerDraft()}
                >
                  {m.editor_reload_server_draft()}
                </button>
                <button
                  type="button"
                  className="underline"
                  onClick={() => void editor.reapplyRecoveredDraft()}
                >
                  {m.editor_reapply_recovered_draft()}
                </button>
                {!editor.conflict && (
                  <button
                    type="button"
                    className="underline"
                    onClick={editor.discardRecoveredDraft}
                  >
                    {m.editor_discard_recovered_draft()}
                  </button>
                )}
              </div>
            </div>
          ) : null}
          {editor.restoreSkippedFields.length > 0 ? (
            <section
              role="status"
              className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <h2 className="font-semibold">
                {m.editor_revision_skipped_fields()}
              </h2>
              <p className="mt-1">{m.editor_revision_keep_current()}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {editor.restoreSkippedFields.map((field) => (
                  <li key={field.key}>
                    <strong>{field.label}</strong>: {field.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {entry?.status === 'scheduled' &&
          entry.scheduledData &&
          entry.scheduledSlug ? (
            <ScheduledVersion
              fields={fields}
              data={entry.scheduledData}
              slug={entry.scheduledSlug}
              siteId={siteId}
              organizationId={site.organizationId}
            />
          ) : null}
          {hasErrors ? (
            <div
              role="alert"
              data-testid="editor-errors"
              className="mx-auto flex w-full max-w-[720px] items-start gap-3 rounded-card border border-border-error/30 bg-status-error-bg px-4 py-3 text-[14px] leading-5 text-text-primary"
            >
              <WarningCircle
                weight="fill"
                className="mt-0.5 size-4 shrink-0 text-icon-error"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">
                  {editor.errorCount > 0
                    ? editor.errorCount === 1
                      ? m.editor_save_fix_one()
                      : m.editor_save_fix_other({ count: editor.errorCount })
                    : m.editor_save_failed()}
                </span>
                {editor.formError ? (
                  <span className="text-callout text-text-secondary">
                    {editor.formError}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
          {previewing ? (
            <div className="mx-auto flex w-full max-w-[720px] items-center justify-between gap-3 rounded-[12px] bg-accent-soft px-4 py-2.5 text-callout text-accent-text">
              <span>{m.editor_previewing_formatting()}</span>
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => setPreviewing(false)}
              >
                {m.editor_back_to_editing()}
              </button>
            </div>
          ) : null}
          <EditorCanvas
            titleField={titleField}
            canvasFields={canvasFields}
            data={data}
            errors={editor.fieldErrors}
            onChange={editor.updateField}
            organizationId={site.organizationId}
            previewing={previewing}
            titleRef={titleRef}
            transitionName={
              editor.entryId ? entryTransitionName(editor.entryId) : undefined
            }
          />
        </section>

        {desktop && detailsOpen ? (
          <aside
            className="sticky top-[72px] -mr-2 max-h-[calc(100dvh-88px)] overflow-y-auto pr-2 pb-6 scroll-quiet"
            aria-label={m.editor_entry_details()}
          >
            {details}
          </aside>
        ) : null}
      </div>

      {!desktop ? (
        <SlideOver
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={m.editor_entry_details()}
          description={title}
          data-testid="details-sheet"
          bodyClassName="bg-background-default pt-2"
        >
          {details}
        </SlideOver>
      ) : null}

      {mobile ? (
        <SlideOver
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          title={m.editor_schedule_title()}
          description={m.editor_schedule_description()}
          data-testid="schedule-sheet"
          fit
        >
          {scheduleForm}
        </SlideOver>
      ) : null}

      <AiSeoDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        siteId={siteId}
        collectionKey={collection.key}
        entryId={editor.entryId}
        data={data}
        seo={seo}
        onApply={(next) => editor.updateField(SEO_KEY, next)}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={m.editor_delete_entry_title()}
        description={
          inboundTitles.length > 0
            ? `${m.editor_delete_entry_description()} ${m.editor_delete_entry_inbound(
                {
                  titles: inboundTitles.join(', '),
                },
              )}`
            : m.editor_delete_entry_description()
        }
        confirmLabel={m.editor_delete()}
        variant="destructive"
        onConfirm={async () => {
          await editor.remove().catch(() => undefined)
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
          if (restoreId) await editor.restore(restoreId).catch(() => undefined)
        }}
      />

      <AlertDialog open={editor.blocker.status === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.editor_leave_unsaved_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {editor.status === 'blocked'
                ? m.editor_leave_unsaved_new()
                : m.editor_leave_unsaved_failed()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => editor.blocker.reset?.()}>
              {m.editor_stay()}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={editor.leaveAnyway}
              data-testid="discard-changes"
            >
              {m.editor_leave_anyway()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div
      className="grid gap-10"
      data-testid="entry-editor"
      data-ready="false"
      aria-busy="true"
    >
      <div className="-mx-6 -mt-6 flex h-14 items-center gap-3 border-b border-border-default px-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <span className="flex-1" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-[30px] w-32 rounded-[8px]" />
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="mx-auto grid w-full max-w-[720px] gap-6 pt-6">
          <Skeleton className="h-11 w-3/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        <div className="hidden gap-4 lg:grid">
          <Skeleton className="h-28 w-full rounded-card" />
          <Skeleton className="h-48 w-full rounded-card" />
        </div>
      </div>
    </div>
  )
}
