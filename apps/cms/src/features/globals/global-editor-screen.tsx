import * as React from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'

import { NotFoundCard } from '#/components/shell/not-found'
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
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { FieldControl } from '#/features/editor/fields/field-control'
import { EditorCanvas } from '#/features/editor/editor-canvas'
import { EntryHistory } from '#/features/editor/history'
import { SeoPanel } from '#/features/editor/seo-panel'
import { useEntryEditor } from '#/features/editor/use-entry-editor'
import { EditorLanguageBar } from '#/features/editor/editor-language-bar'
import { EditorNotices } from '#/features/editor/editor-notices'
import { LanguageFade } from '#/features/editor/language-fade'
import { LocaleFieldsContext } from '#/features/editor/locale-fields'
import { revealField } from '#/features/editor/reveal-field'
import { useClickSource } from '#/features/editor/use-click-source'
import { useEditorSession } from '#/features/editor/use-editor-session'
import {
  entryUiStatus,
  isEditedSinceReady,
} from '#/features/golive/entry-live-state'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { SlideOver } from '#/components/ui/slide-over'
import { initialEntryData } from '#/lib/content/utils'
import { isDevSite } from '#/lib/site-environment'
import { canManageSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { readEntrySeo, SEO_KEY } from '#/lib/seo'
import { previewOrigin } from '#/lib/preview-url'
import { getGlobalFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'
import { LazyPreviewPane } from '#/features/visual/lazy-preview-pane'
import { VisualEditorLayout } from '#/features/visual/visual-editor-layout'
import { VisualFullScreenProvider } from '#/features/visual/visual-context'
import { VisualShortcuts } from '#/features/visual/visual-shortcuts'
import {
  VISUAL_TOKEN_REFRESH_MS,
  useVisualMode,
  useVisualModeActive,
} from '#/features/visual/visual-mode'

import { GlobalEditorTopBar } from './global-editor-top-bar'
import { groupFields } from './site-content'

/** The section row (a collection row, kind global). */
export type GlobalRecord = Awaited<ReturnType<typeof getGlobalFn>>['global']

export function globalQueryKey(siteId: string, key: string) {
  return ['global', siteId, key] as const
}

export function globalQuery(siteId: string, key: string) {
  return queryOptions({
    queryKey: globalQueryKey(siteId, key),
    queryFn: () => getGlobalFn({ data: { siteId, key } }),
    retry: false,
  })
}

/**
 * Site content section editor (route `/sites/$siteId/globals/$globalKey`).
 * One form, no title and no slug: the section is a single entry that the
 * entry editor machinery saves, marks ready and restores, with the section
 * functions on the server. Disabled sections are not found for editors.
 */
export function GlobalEditorScreen({
  me,
  site,
  globalKey,
}: {
  me: Me
  site: MeSite
  globalKey: string
}) {
  const isAgency = me.user.isAgencyAdmin
  const query = useQuery(globalQuery(site.id, globalKey))

  if (query.isLoading) return <GlobalEditorSkeleton />
  if (query.isError) {
    return (
      <QueryError
        title={m.globals_could_not_load()}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  if (!query.data || (!query.data.global.enabled && !isAgency)) {
    return <NotFoundCard />
  }

  return (
    <GlobalEditorView
      key={`${site.id}:${globalKey}`}
      me={me}
      site={site}
      global={query.data.global}
      entryId={query.data.entry.id}
    />
  )
}

function GlobalEditorView({
  me,
  site,
  global,
  entryId,
}: {
  me: Me
  site: MeSite
  global: GlobalRecord
  entryId: string
}) {
  const siteId = site.id
  const canManage = canManageSite(me, site.organizationId)
  // A development environment has no scheduling (Decision 8).
  const canSchedule = !isDevSite(site)
  const devSite = isDevSite(site)
  const release = useReleaseStatus(siteId)
  const live = release.liveMembership
  const titleRef = React.useRef<HTMLTextAreaElement>(null)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [restoreId, setRestoreId] = React.useState<string | null>(null)

  const fields = global.fields
  // Visual mode (docs/design/visual-editor.md). Sections with no preview path
  // have nothing to show, so they do not reopen in Visual by themselves.
  const visual = useVisualMode({ supported: Boolean(global.previewPath) })
  const editor = useEntryEditor({
    siteId,
    collectionKey: global.key,
    globalKey: global.key,
    fields,
    entryId,
    previewRefetchInterval: visual.active ? VISUAL_TOKEN_REFRESH_MS : undefined,
  })
  const { entry, data } = editor
  const session = useEditorSession({
    editor,
    site,
    fields,
    requiredLanguages: global.requiredLanguages,
    seoEnabled: global.seoEnabled,
    copyDestination: { kind: 'global', globalKey: global.key },
    reveal: revealField,
  })
  const { ctx, active, view } = session
  // Click to edit: every field the column shows, plus the SEO fields.
  const clickSource = useClickSource({
    editor,
    siteId,
    fields,
    seo: global.seoEnabled,
    globalKey: global.key,
    reveal: revealField,
  })

  if (editor.loading || !entry) return <GlobalEditorSkeleton />

  const uiStatus = entryUiStatus(entry, live, devSite)
  const editedSinceReady = isEditedSinceReady({
    status: entry.status,
    updatedAt: entry.updatedAt,
    draftData: initialEntryData(fields, entry.draftData),
    publishedData: entry.publishedData
      ? initialEntryData(fields, entry.publishedData)
      : entry.publishedData,
  })
  const hasReady = entry.status === 'published' || entry.status === 'scheduled'
  const changed = editedSinceReady || editor.dirty
  const discardReason = !hasReady
    ? m.globals_never_ready()
    : !changed
      ? m.globals_discard_unavailable()
      : null
  const previewAvailable = Boolean(global.previewPath)
  const previewReason = previewAvailable
    ? null
    : m.globals_preview_unavailable()

  const groups = groupFields(fields)
  const seoOn = global.seoEnabled

  function openPreview() {
    if (editor.previewUrl) window.open(editor.previewUrl, '_blank', 'noopener')
  }

  // Visual mode needs a preview path and a loaded preview URL.
  const canVisual = Boolean(global.previewPath && editor.previewUrl)
  const visualReason = canVisual ? null : previewReason

  // The section's fields: the column in Write mode, the left column in Visual.
  const fieldsColumn = (
    <>
      <EditorNotices editor={editor} fields={fields} onReveal={revealField} />

      {fields.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border-strong px-4 py-4 text-center text-callout text-text-secondary">
          {m.globals_no_fields()}
        </p>
      ) : null}

      {groups.map((group, index) => (
        <div
          key={`${index}-${group.group ?? ''}`}
          className={cn('grid gap-6', group.group && 'gap-5')}
        >
          {group.group ? (
            <h2 className="text-headline text-text-primary">{group.group}</h2>
          ) : null}
          {group.fields.map((field) =>
            field.type === 'richtext' ? (
              <EditorCanvas
                key={field.key}
                canvasFields={[field]}
                data={view}
                errors={editor.fieldErrors}
                onChange={session.onLocaleChange}
                organizationId={site.organizationId}
                linkContext={{
                  siteId,
                  entryId: null,
                  locale: ctx && active ? active : null,
                  devSite,
                }}
                previewing={false}
                titleRef={titleRef}
              />
            ) : (
              <FieldControl
                key={field.key}
                field={field}
                value={view[field.key]}
                onChange={(value) => session.onLocaleChange(field.key, value)}
                error={editor.fieldErrors[field.key]}
                siteId={siteId}
                devSite={devSite}
                organizationId={site.organizationId}
              />
            ),
          )}
        </div>
      ))}

      {seoOn ? (
        <div className="grid gap-4 border-t border-border-default pt-6">
          <SeoPanel
            seo={readEntrySeo(view)}
            onChange={(next) => session.onLocaleChange(SEO_KEY, next)}
            errors={editor.fieldErrors}
            organizationId={site.organizationId}
            productionUrl={site.productionUrl}
            routePattern={global.previewPath ?? ''}
            slug=""
            entryTitle={global.label}
            fallbackDescription={null}
            aiEnabled={false}
            onGenerate={() => undefined}
            global
          />
        </div>
      ) : null}
    </>
  )

  return (
    <VisualFullScreenProvider active={visual.active}>
      <VisualShortcuts mode={visual} canVisual={canVisual} />
      <LocaleFieldsContext.Provider value={session.localeFields}>
        <div
          data-testid="global-editor"
          data-ready={editor.ready ? 'true' : 'false'}
          data-dirty={editor.dirty ? 'true' : 'false'}
          data-entry-id={editor.entryId}
          data-view={visual.active ? 'visual' : 'write'}
          style={
            {
              '--editor-bar-h': session.multilingual ? '100px' : '56px',
            } as React.CSSProperties
          }
          className={
            visual.active ? 'min-h-[100dvh]' : '-mb-6 min-h-[calc(100dvh-3rem)]'
          }
        >
          <GlobalEditorTopBar
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
                    disabledReason: visualReason,
                    onSetMode: visual.setMode,
                  }
                : undefined
            }
            label={global.label}
            canSchedule={canSchedule}
            hasReady={hasReady}
            discardReason={discardReason}
            preview={{
              available: previewAvailable,
              reason: previewReason,
              open: openPreview,
            }}
            schedule={{
              open: scheduleOpen,
              onOpenChange: setScheduleOpen,
              onSubmit: async (at, timeZone) => {
                // A form opened before the conflict must not approve over it.
                if (editor.conflict) return
                const result = await editor
                  .schedule(at, timeZone)
                  .catch(() => null)
                if (result) setScheduleOpen(false)
              },
            }}
            onOpenHistory={() => setHistoryOpen(true)}
          />

          {visual.active ? (
            <VisualEditorLayout
              column={
                <LanguageFade locale={active ?? ''} enabled={active !== null}>
                  <section
                    className="grid w-full gap-8"
                    aria-label={m.globals_canvas_label()}
                    data-testid="global-fields"
                  >
                    {fieldsColumn}
                  </section>
                </LanguageFade>
              }
              preview={
                <LazyPreviewPane
                  previewUrl={editor.previewUrl}
                  title={global.label}
                  lastSavedAt={editor.lastSavedAt}
                  unavailableReason={visualReason}
                  live={{
                    origin: previewOrigin(site),
                    siteId,
                    target: editor.entryId
                      ? { kind: 'global', global: global.key }
                      : null,
                    data,
                    locale: active,
                  }}
                  click={clickSource}
                />
              }
            />
          ) : (
            <LanguageFade locale={active ?? ''} enabled={active !== null}>
              <section
                className="mx-auto grid w-full max-w-[720px] gap-8 pt-4 pb-24 sm:pt-8"
                aria-label={m.globals_canvas_label()}
                data-testid="global-fields"
              >
                {fieldsColumn}
              </section>
            </LanguageFade>
          )}

          <SlideOver
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            title={m.globals_history_title()}
            description={global.label}
            data-testid="global-history-sheet"
            bodyClassName="bg-background-default pt-2"
          >
            <EntryHistory
              entryId={editor.entryId}
              canManage={canManage}
              onRestore={setRestoreId}
            />
          </SlideOver>

          {session.translate.dialog}

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

          <AlertDialog open={editor.blocker.status === 'blocked'}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {m.editor_leave_unsaved_title()}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {m.editor_leave_unsaved_failed()}
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

function GlobalEditorSkeleton() {
  const fullBleed = useVisualModeActive()
  return (
    <div
      className="grid gap-10"
      data-testid="global-editor"
      data-ready="false"
      aria-busy="true"
    >
      <div
        className={cn(
          'flex h-14 items-center gap-3 border-b border-border-default px-4',
          !fullBleed && '-mx-6 -mt-6',
        )}
      >
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-5 w-14 rounded-full" />
        <span className="flex-1" />
        <Skeleton className="h-[30px] w-32 rounded-[8px]" />
      </div>
      <div className="mx-auto grid w-full max-w-[720px] gap-6 pt-6">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    </div>
  )
}
