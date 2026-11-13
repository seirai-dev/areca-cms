import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Stack } from '@phosphor-icons/react'

import { queryKeys } from '#/lib/query-keys'
import { richTextPlainText } from '#/lib/richtext-text'
import { collectionsQuery as collectionsOptions } from '#/lib/content/queries'
import { initialEntryData } from '#/lib/content/utils'
import { TOGGLE_DETAILS_EVENT } from '#/components/shell/shortcuts'
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
import { SlideOver } from '#/components/ui/slide-over'
import { entryTransitionName } from '#/features/collection/entry-item'
import { SLUG_KEY } from '#/lib/content-locale'
import {
  entryUiStatus,
  isEditedSinceReady,
} from '#/features/golive/entry-live-state'
import { canGoLive } from '#/features/golive/go-live-gate'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { usePanel } from '#/features/shell/panel'
import { useIsMobile, useMediaQuery } from '#/hooks/use-mobile'
import { previewOrigin } from '#/lib/preview-url'
import { isDevSite } from '#/lib/site-environment'
import { canManageSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { readEntrySeo, SEO_KEY } from '#/lib/seo'
import type { listCollectionsFn } from '#/server/fn/content'
import { listInboundReferencesFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'

import { LazyAiSeoDialog } from './lazy-parts'

import { DetailsPanel } from './details-panel'
import type { LanguageRow } from './details-panel'
import { SectionLinkDialog } from './section-link-dialog'
import { EditorCanvas } from './editor-canvas'
import { EditorSkeleton } from './editor-skeleton'
import { EditorTopBar } from './editor-top-bar'
import type { PrimaryState } from './editor-top-bar'
import { EditorLanguageBar } from './editor-language-bar'
import { EditorNotices } from './editor-notices'
import { LanguageFade } from './language-fade'
import { uiLanguageName } from '#/lib/site-languages'
import { LocaleFieldsContext } from './locale-fields'
import { ScheduledVersion } from './scheduled-version'
import { ScheduleForm } from './schedule-form'
import { SeoPanel } from './seo-panel'
import { useClickSource } from './use-click-source'
import { useEditorSession } from './use-editor-session'
import { useEntryEditor } from './use-entry-editor'
import { LazyPreviewPane } from '#/features/visual/lazy-preview-pane'
import { VisualEditorLayout } from '#/features/visual/visual-editor-layout'
import { VisualFullScreenProvider } from '#/features/visual/visual-context'
import { VisualShortcuts } from '#/features/visual/visual-shortcuts'
import { revealField } from './reveal-field'
import {
  VISUAL_TOKEN_REFRESH_MS,
  useVisualMode,
} from '#/features/visual/visual-mode'

type CollectionRecord = Awaited<ReturnType<typeof listCollectionsFn>>[number]

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
  const collectionsQuery = useQuery(collectionsOptions(site.id))
  const collection = collectionsQuery.data?.find(
    (item) => item.key === collectionKey,
  )

  if (collectionsQuery.isLoading) return <EditorSkeleton />
  if (collectionsQuery.isError) {
    return (
      <QueryError
        title={m.sites_collections_load_error()}
        query={collectionsQuery}
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
  const isDev = isDevSite(site)
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
  // Visual mode (docs/design/visual-editor.md). A new entry has no preview
  // until its first save, so it does not reopen in Visual by itself.
  const visual = useVisualMode({ autoEnter: Boolean(routeEntryId) })
  const editor = useEntryEditor({
    siteId,
    collectionKey: collection.key,
    fields,
    entryId: routeEntryId,
    onCreated,
    onDeleted,
    onRevealError: reveal,
    previewRefetchInterval: visual.active ? VISUAL_TOKEN_REFRESH_MS : undefined,
  })
  const { entry, data, titleField, slugField } = editor

  const session = useEditorSession({
    editor,
    site,
    fields,
    requiredLanguages: collection.requiredLanguages,
    seoEnabled: true,
    translatedSlug: true,
    copyDestination: { kind: 'collection', collectionKey: collection.key },
    reveal,
  })
  const { lang, ctx, active, view, mainView, summaries } = session
  const notMainLocale = Boolean(ctx && active && !lang.isMain)

  const languageRows: LanguageRow[] | undefined =
    lang.languages && ctx
      ? summaries.map((summary) => ({
          summary,
          name: uiLanguageName(summary.locale),
        }))
      : undefined
  const clickSource = useClickSource({
    editor,
    siteId,
    fields,
    seo: true,
    globalKey: null,
    reveal,
  })
  const mainSlugValue = slugField ? mainView[slugField.key] : undefined
  const inboundQuery = useQuery({
    queryKey: queryKeys.inboundReferences(editor.entryId ?? ''),
    queryFn: () => listInboundReferencesFn({ data: { id: editor.entryId! } }),
    enabled: deleteOpen && Boolean(editor.entryId),
  })
  const inboundTitles = (inboundQuery.data ?? []).map((row) => row.title)
  const [aiOpen, setAiOpen] = React.useState(false)
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

  /**
   * Scrolls to and focuses a field. The details panel opens first when it
   * holds the field. `pulse` makes it glow briefly, for a click in the visual
   * preview.
   */
  function reveal(key: string, options: { pulse?: boolean } = {}) {
    revealField(key, {
      pulse: options.pulse,
      beforeReveal: () => {
        const inPanel =
          key === slugField?.key ||
          key.startsWith(`${SEO_KEY}.`) ||
          panelFields.some((field) => field.key === key)
        if (inPanel) openDetails()
      },
    })
  }

  React.useEffect(() => {
    const onToggle = () => toggleDetails()
    window.addEventListener(TOGGLE_DETAILS_EVENT, onToggle)
    return () => window.removeEventListener(TOGGLE_DETAILS_EVENT, onToggle)
  })

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

  // A development environment has no releases: no "unreleased changes" dot.
  const editedSinceReady = React.useMemo(
    () =>
      entry && !isDev
        ? isEditedSinceReady({
            status: entry.status,
            updatedAt: entry.updatedAt,
            draftData: initialEntryData(fields, entry.draftData),
            publishedData: entry.publishedData
              ? initialEntryData(fields, entry.publishedData)
              : entry.publishedData,
          })
        : false,
    [entry, isDev, fields],
  )
  const linkLocale = ctx ? active : null
  const linkContext = React.useMemo(
    () => ({
      siteId,
      entryId: editor.entryId ?? null,
      locale: linkLocale,
      devSite: isDev,
    }),
    [siteId, editor.entryId, linkLocale, isDev],
  )

  if (routeEntryId && editor.entryQuery.isError && !entry) {
    return (
      <div
        className="mx-auto grid max-w-xl gap-4 py-16"
        data-testid="entry-editor"
        data-ready="false"
      >
        <QueryError
          query={editor.entryQuery}
          title={m.editor_could_not_load_entry()}
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
    typeof view[titleField.key] === 'string' &&
    (view[titleField.key] as string).trim()
      ? (view[titleField.key] as string)
      : m.editor_untitled()
  const uiStatus = entry ? entryUiStatus(entry, live, isDev) : 'draft'
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

  const seo = readEntrySeo(view)
  // A translation without its own slug uses the main slug.
  const ownSlug = view[SLUG_KEY]
  const slugValue = slugField
    ? notMainLocale
      ? typeof ownSlug === 'string' && ownSlug
        ? ownSlug
        : mainSlugValue
      : view[slugField.key]
    : undefined
  const excerptField = fields.find(
    (field) =>
      field.type === 'textarea' &&
      typeof view[field.key] === 'string' &&
      (view[field.key] as string).trim(),
  )
  const bodyField = fields.find((field) => field.type === 'richtext')
  const fallbackDescription = excerptField
    ? (view[excerptField.key] as string)
    : bodyField
      ? richTextPlainText(view[bodyField.key]) || null
      : null
  // The slug field edits the language's own `$slug` on translations.
  const detailsData =
    slugField && notMainLocale
      ? { ...view, [slugField.key]: typeof ownSlug === 'string' ? ownSlug : '' }
      : view

  const details = (
    <DetailsPanel
      siteId={siteId}
      devSite={isDev}
      organizationId={site.organizationId}
      productionUrl={site.productionUrl}
      routePattern={collection.routePattern}
      fields={panelFields}
      slugField={slugField}
      titleField={titleField}
      data={detailsData}
      errors={editor.fieldErrors}
      onChange={session.onLocaleChange}
      slugManual={editor.slugManual && !notMainLocale}
      onResetSlug={editor.resetSlugFromTitle}
      slugPlaceholder={
        notMainLocale && typeof mainSlugValue === 'string'
          ? mainSlugValue
          : undefined
      }
      slugHelper={notMainLocale ? m.editor_language_slug_helper() : undefined}
      languageRows={languageRows}
      onSelectLanguage={lang.setActive}
      entry={entry}
      entryId={editor.entryId}
      live={live}
      isNew={editor.isNew}
      canManage={canManage}
      onRestore={setRestoreId}
      onCancelSchedule={editor.cancelSchedule}
      seoPanel={
        <SeoPanel
          seo={seo}
          onChange={(next) => session.onLocaleChange(SEO_KEY, next)}
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
          aiEnabled={session.aiEnabled}
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
        // A form opened before the conflict must not approve over it.
        if (editor.conflict) return
        const result = await editor.schedule(at, timeZone).catch(() => null)
        if (result) setScheduleOpen(false)
      }}
    />
  )

  const canvas = (
    <EditorCanvas
      titleField={titleField}
      canvasFields={canvasFields}
      data={view}
      errors={editor.fieldErrors}
      onChange={session.onLocaleChange}
      organizationId={site.organizationId}
      linkContext={linkContext}
      previewing={previewing}
      titleRef={titleRef}
      transitionName={
        editor.entryId ? entryTransitionName(editor.entryId) : undefined
      }
      compact={visual.active}
    />
  )

  // Shared by both layouts: the same notices, in the same order.
  const notices = (
    <>
      <EditorNotices
        editor={editor}
        fields={fields}
        onReveal={reveal}
        className="mx-auto w-full max-w-[720px]"
      >
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
      </EditorNotices>
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
    </>
  )
  const canvasBlock = active ? (
    <LanguageFade locale={active}>{canvas}</LanguageFade>
  ) : (
    canvas
  )

  // Visual mode has no preview until the entry has a URL (Tier 0).
  const canVisual = Boolean(editor.previewUrl)
  const previewReason = canVisual
    ? null
    : editor.isNew
      ? m.visual_mode_first_save()
      : entry?.slug
        ? null
        : m.editor_preview_no_slug()

  return (
    <VisualFullScreenProvider active={visual.active}>
      <VisualShortcuts mode={visual} canVisual={canVisual} />
      <LocaleFieldsContext.Provider value={session.localeFields}>
        <div
          data-testid="entry-editor"
          data-ready={editor.ready ? 'true' : 'false'}
          data-dirty={editor.dirty ? 'true' : 'false'}
          data-entry-id={editor.entryId}
          data-view={visual.active ? 'visual' : 'write'}
          style={
            {
              // Sticky offsets below the header: 56px row, plus the 44px language row.
              '--editor-bar-h': session.multilingual ? '100px' : '56px',
            } as React.CSSProperties
          }
          className={
            visual.active ? 'min-h-[100dvh]' : '-mb-6 min-h-[calc(100dvh-3rem)]'
          }
        >
          <EditorTopBar
            editor={editor}
            siteId={siteId}
            uiStatus={uiStatus}
            editedSinceReady={editedSinceReady}
            canManage={canManage}
            readyBlock={session.readyBlock}
            copyAction={session.copyAction}
            languageBar={
              <EditorLanguageBar session={session} fields={fields} />
            }
            visualMode={
              visual.available
                ? {
                    active: visual.active,
                    canVisual,
                    disabledReason: previewReason,
                    onSetMode: visual.setMode,
                  }
                : undefined
            }
            collection={collection}
            title={title}
            showTitle={!titleVisible}
            primary={primary}
            devSite={isDev}
            goLiveBlocked={
              !canGoLive({
                canPublish: canManage,
                blockers: release.data?.blockers,
              })
            }
            formatting={
              canvasFields.some((field) => field.type === 'richtext')
                ? {
                    on: previewing,
                    onToggle: () => setPreviewing((value) => !value),
                  }
                : null
            }
            onGenerateSeo={
              session.aiEnabled ? () => setAiOpen(true) : undefined
            }
            onGoLiveNow={() => void goLiveNow()}
            onSchedule={() => setScheduleOpen(true)}
            onDelete={() => setDeleteOpen(true)}
            details={
              visual.active
                ? null
                : { open: detailsOpen, onToggle: toggleDetails }
            }
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

          {visual.active ? (
            <VisualEditorLayout
              column={
                <>
                  {notices}
                  {canvasBlock}
                  {details}
                </>
              }
              preview={
                <LazyPreviewPane
                  previewUrl={editor.previewUrl}
                  title={title}
                  lastSavedAt={editor.lastSavedAt}
                  unavailableReason={previewReason}
                  live={{
                    origin: previewOrigin(site),
                    siteId,
                    target: editor.entryId
                      ? {
                          kind: 'entry',
                          collection: collection.key,
                          entryId: editor.entryId,
                        }
                      : null,
                    data,
                    locale: active,
                  }}
                  click={clickSource}
                />
              }
            />
          ) : (
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
                {notices}
                {canvasBlock}
              </section>

              {desktop && detailsOpen ? (
                <aside
                  className="sticky top-[calc(var(--editor-bar-h,56px)+16px)] -mr-2 max-h-[calc(100dvh-var(--editor-bar-h,56px)-32px)] overflow-y-auto pr-2 pb-6 scroll-quiet"
                  aria-label={m.editor_entry_details()}
                >
                  {details}
                </aside>
              ) : null}
            </div>
          )}

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

          {session.translate.dialog}

          <LazyAiSeoDialog
            open={aiOpen}
            onOpenChange={setAiOpen}
            siteId={siteId}
            collectionKey={collection.key}
            entryId={editor.entryId}
            locale={ctx ? active : null}
            data={view}
            seo={seo}
            onApply={(next) => session.onLocaleChange(SEO_KEY, next)}
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
              if (restoreId)
                await editor.restore(restoreId).catch(() => undefined)
            }}
          />

          {editor.sectionChanges.length > 0 ? (
            <SectionLinkDialog
              changes={editor.sectionChanges}
              live={live}
              devSite={isDev}
              multilingual={Boolean(lang.languages)}
              pending={editor.applyingSectionChanges}
              onApply={(updates) => {
                void editor.applySectionChanges(updates).catch(() => undefined)
              }}
              onClose={editor.dismissSectionChanges}
            />
          ) : null}

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
      </LocaleFieldsContext.Provider>
    </VisualFullScreenProvider>
  )
}
