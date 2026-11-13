import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { WarningCircle } from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'

import { useShortcut } from '#/components/shell/shortcuts'
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
import { baseLocale, readLocale } from '#/lib/content-locale'
import { LanguageBar } from '#/features/editor/language-bar'
import { LanguageFade } from '#/features/editor/language-fade'
import { uiLanguageName } from '#/lib/site-languages'
import {
  blockersFor,
  fieldLabels,
  localeContext,
  localeSummaries,
  requiredLocales,
} from '#/features/editor/language-state'
import type { LocaleBlocker } from '#/features/editor/language-state'
import { LocaleFieldsContext } from '#/features/editor/locale-fields'
import type { LocaleFields } from '#/features/editor/locale-fields'
import { useContentLanguage } from '#/features/editor/use-content-language'
import { TranslateLanguageButton } from '#/features/editor/translate-language-button'
import { useAiTranslation } from '#/features/editor/use-ai-translation'
import {
  entryUiStatus,
  isEditedSinceReady,
} from '#/features/golive/entry-live-state'
import { useCopyEntryAction } from '#/features/dev-env/use-copy-to-production'
import { useReleaseStatus } from '#/features/golive/use-release-status'
import { QueryError } from '#/components/ui/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { SlideOver } from '#/components/ui/slide-over'
import { initialEntryData } from '#/lib/content/utils'
import { isDevSite } from '#/lib/site-environment'
import { canManageSite } from '#/lib/site-nav'
import type { MeSite } from '#/lib/site-nav'
import type { Field } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { readEntrySeo, SEO_KEY } from '#/lib/seo'
import { previewOrigin } from '#/lib/preview-url'
import { getAiAvailabilityFn } from '#/server/fn/ai'
import { getGlobalFn } from '#/server/fn/content'
import type { Me } from '#/server/fn/me'
import { LazyPreviewPane } from '#/features/visual/lazy-preview-pane'
import type { ClickSource } from '#/features/visual/preview-pane'
import { VisualEditorLayout } from '#/features/visual/visual-editor-layout'
import { VisualFullScreenProvider } from '#/features/visual/visual-context'
import { VisualShortcuts } from '#/features/visual/visual-shortcuts'
import { seoClickFields } from '#/features/visual/click-fields'
import {
  VISUAL_TOKEN_REFRESH_MS,
  useVisualMode,
  useVisualModeActive,
} from '#/features/visual/visual-mode'

import {
  conflictReadyBlock,
  EditorConflictNotice,
} from '#/features/editor/conflict-notice'
import { announceReveal, pulseField } from '#/features/editor/reveal-field'
import { GlobalEditorTopBar } from './global-editor-top-bar'
import { groupFields } from './site-content'

/** The section row as `listGlobals` returns it (a collection row, kind global). */
export type GlobalRecord = {
  id: string
  key: string
  label: string
  enabled: boolean
  seoEnabled: boolean
  previewPath: string | null
  fields: Field[]
  /** Languages besides main that must be complete before going live. */
  requiredLanguages?: string[]
}

export function globalQueryKey(siteId: string, key: string) {
  return ['global', siteId, key] as const
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
  const query = useQuery({
    queryKey: globalQueryKey(site.id, globalKey),
    queryFn: () => getGlobalFn({ data: { siteId: site.id, key: globalKey } }),
    retry: false,
  })

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
  const found = query.data?.global as GlobalRecord | undefined
  if (!found || (!found.enabled && !isAgency)) {
    return <NotFoundCard />
  }

  return (
    <GlobalEditorView
      key={`${site.id}:${globalKey}`}
      me={me}
      site={site}
      global={found}
      entryId={query.data!.entry.id}
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
  const navigate = useNavigate()
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
  // Click to edit: every field the column shows, plus the SEO fields.
  const clickFields = React.useMemo(
    () => [
      ...fields.map((field) => ({ key: field.key, label: field.label })),
      ...(global.seoEnabled ? seoClickFields() : []),
    ],
    [fields, global.seoEnabled],
  )

  // Content languages (multilingual sites only; null otherwise).
  const lang = useContentLanguage({ siteId, languages: site.languages })
  const active = lang.active
  const ctx = React.useMemo(
    () => (lang.languages ? localeContext(lang.languages, fields) : null),
    [lang.languages, fields],
  )
  const requiredLanguages = global.requiredLanguages ?? []
  const requiredKey = requiredLanguages.join('|')
  const required = lang.languages
    ? requiredLocales(lang.languages, requiredLanguages)
    : []
  const summaries = React.useMemo(
    () => (ctx ? localeSummaries(data, ctx, required) : []),
    // `requiredKey` stands in for the contents of `required`.
    [data, ctx, requiredKey],
  )
  const view = React.useMemo(
    () => (ctx && active ? readLocale(data, active, ctx) : data),
    [data, ctx, active],
  )
  const mainView = React.useMemo(
    () => (ctx ? readLocale(data, lang.main, ctx) : data),
    [data, ctx, lang.main],
  )
  // AI translation needs AI set up and a saved section (the server reads it).
  const aiQuery = useQuery({
    queryKey: queryKeys.aiAvailability(),
    queryFn: () => getAiAvailabilityFn(),
    staleTime: 30_000,
  })
  const translateEnabled =
    aiQuery.data?.enabled === true && Boolean(editor.entryId)
  const translate = useAiTranslation({
    siteId,
    entryId: editor.entryId ?? '',
    fields,
    main: lang.main,
    active: active ?? lang.main,
    source: mainView,
    target: view,
    seoEnabled: global.seoEnabled,
    applyPatch: (patch) => {
      if (ctx && active) editor.updateLocaleFields(patch, active, ctx)
    },
    save: editor.save,
  })
  const localeFields: LocaleFields | null =
    ctx && active
      ? {
          active,
          main: lang.main,
          mainName: uiLanguageName(lang.main),
          mainView,
          isMain: lang.isMain,
          onTranslateField: translateEnabled ? translate.translateField : null,
          translatingKey:
            translate.pendingScope === 'language'
              ? null
              : translate.pendingScope,
        }
      : null
  const blockers = ctx ? blockersFor(data, ctx, required) : []
  const blocker: LocaleBlocker | null =
    editor.serverBlockers.at(0) ?? blockers.at(0) ?? null

  function focusBlocker(item: LocaleBlocker) {
    lang.setActive(item.locale)
    const key = item.missing[0]
    if (!key) return
    requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(key)}"]`,
      )
      node
        ?.querySelector<HTMLElement>(
          'input, textarea, [contenteditable="true"]',
        )
        ?.focus()
    })
  }

  const languageBlock = blocker
    ? {
        message: m.editor_language_blocker({
          language: uiLanguageName(blocker.locale),
          fields: fieldLabels(blocker.missing, fields).join(', '),
        }),
        onFix: () => focusBlocker(blocker),
      }
    : null
  const conflictBlock = conflictReadyBlock(
    editor.conflict,
    () => void editor.reloadServerDraft(),
  )
  const readyBlock = conflictBlock ?? languageBlock

  // Writes the active language; the main language (and single-language
  // sites) use the ordinary update.
  function onLocaleChange(key: string, value: unknown) {
    if (!ctx || !active) {
      editor.updateField(key, value)
      return
    }
    if (lang.isMain && baseLocale(data, ctx) === lang.main) {
      editor.updateField(key, value)
      return
    }
    editor.updateLocaleField(key, value, active, ctx)
  }

  useShortcut('mod+s', () => void editor.save())

  // Copy to production: dev envs only (docs/design/dev-environments.md, Decision 18).
  const copyAction = useCopyEntryAction({
    devSiteId: siteId,
    productionSiteId: site.parentSiteId,
    isDevelopment: devSite,
    collectionKey: global.key,
    destination: { kind: 'global', globalKey: global.key },
    devEntryId: entryId,
    save: editor.save,
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
  const canDiscard = hasReady && changed
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
  const hasErrors = editor.errorCount > 0 || Boolean(editor.formError)
  const errorKeys = Object.keys(editor.fieldErrors).filter(Boolean)

  /**
   * Scrolls to and focuses a field (the save banner's links, a click in the
   * visual preview). `pulse` makes it glow briefly. An SEO field opens its
   * collapsed group first, via announceReveal.
   */
  function revealField(key: string, options: { pulse?: boolean } = {}) {
    announceReveal(key)
    const attempt = (tries: number) => {
      const node = document.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(key)}"]`,
      )
      if (!node) {
        if (tries > 0) window.setTimeout(() => attempt(tries - 1), 120)
        return
      }
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const focusable = node.matches(
        'input, textarea, [contenteditable="true"], button',
      )
        ? node
        : node.querySelector<HTMLElement>(
            'input, textarea, [contenteditable="true"], button',
          )
      focusable?.focus({ preventScroll: true })
      if (options.pulse) pulseField(node)
    }
    requestAnimationFrame(() => attempt(5))
  }

  function openPreview() {
    if (editor.previewUrl) window.open(editor.previewUrl, '_blank', 'noopener')
  }

  // Click to edit: the fields a preview may open, and where "Open" goes.
  const clickSource: ClickSource = {
    self: { entryId: editor.entryId ?? null, globalKey: global.key },
    fields: clickFields,
    onSelectField: (key) => revealField(key, { pulse: true }),
    onOpenOwner: (owner) => {
      void (async () => {
        // Save first, so nothing typed here is left behind.
        await editor.save().catch(() => null)
        if (owner.kind === 'entry') {
          await navigate({
            to: '/sites/$siteId/c/$collectionKey/$entryId',
            params: {
              siteId,
              collectionKey: owner.collectionKey,
              entryId: owner.entryId,
            },
            search: { view: 'visual' },
          })
        } else {
          await navigate({
            to: '/sites/$siteId/globals/$globalKey',
            params: { siteId, globalKey: owner.globalKey },
            search: { view: 'visual' },
          })
        }
      })()
    },
  }

  // Visual mode needs a preview path and a loaded preview URL.
  const canVisual = Boolean(global.previewPath && editor.previewUrl)
  const visualReason = canVisual ? null : previewReason

  const languageBar =
    lang.languages && ctx && active ? (
      <LanguageBar
        main={lang.main}
        active={active}
        summaries={summaries}
        fields={fields}
        onSelect={lang.setActive}
        trailing={
          translateEnabled && !lang.isMain ? (
            <TranslateLanguageButton
              label={m.editor_translate_language({
                language: uiLanguageName(lang.main),
              })}
              running={translate.pendingScope === 'language'}
              disabled={!translate.hasSource}
              disabledReason={m.editor_translate_add_source({
                language: uiLanguageName(lang.main),
              })}
              onClick={translate.translateLanguage}
            />
          ) : undefined
        }
      />
    ) : undefined

  // The section's fields: the column in Write mode, the left column in Visual.
  const fieldsColumn = (
    <>
      <EditorConflictNotice
        conflict={editor.conflict}
        approvalConflict={editor.approvalConflict}
        recoveredDraft={Boolean(editor.recoveredDraft)}
        className="grid gap-3 rounded-card border border-border-error/30 p-4"
        onReload={() => void editor.reloadServerDraft()}
        onReapply={() => void editor.reapplyRecoveredDraft()}
        onDiscard={editor.discardRecoveredDraft}
      />

      {editor.restoreSkippedFields.length > 0 ? (
        <section
          role="status"
          className="grid gap-2 rounded-card border border-border-default p-4"
        >
          <h2 className="text-headline text-text-primary">
            {m.editor_revision_skipped_fields()}
          </h2>
          <p className="text-callout text-text-secondary">
            {m.editor_revision_keep_current()}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-callout">
            {editor.restoreSkippedFields.map((field) => (
              <li key={field.key}>
                <strong>{field.label}</strong>: {field.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasErrors ? (
        <div
          role="alert"
          data-testid="editor-errors"
          className="flex items-start gap-3 rounded-card border border-border-error/30 bg-status-error-bg px-4 py-3 text-[14px] leading-5 text-text-primary"
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
            {errorKeys.length > 0 ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {errorKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => revealField(key)}
                    className="text-callout font-medium text-text-primary underline decoration-border-error underline-offset-4 hover:decoration-current"
                  >
                    {fieldLabels([key], fields)[0] ?? key}
                  </button>
                ))}
              </span>
            ) : null}
            {editor.formError ? (
              <span className="text-callout text-text-secondary">
                {editor.formError}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

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
                onChange={onLocaleChange}
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
                onChange={(value) => onLocaleChange(field.key, value)}
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
            onChange={(next) => onLocaleChange(SEO_KEY, next)}
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
      <LocaleFieldsContext.Provider value={localeFields}>
        <div
          data-testid="global-editor"
          data-ready={editor.ready ? 'true' : 'false'}
          data-dirty={editor.dirty ? 'true' : 'false'}
          data-entry-id={editor.entryId}
          data-view={visual.active ? 'visual' : 'write'}
          style={
            {
              '--editor-bar-h': languageBar ? '100px' : '56px',
            } as React.CSSProperties
          }
          className={
            visual.active ? 'min-h-[100dvh]' : '-mb-6 min-h-[calc(100dvh-3rem)]'
          }
        >
          <GlobalEditorTopBar
            languageBar={languageBar}
            readyBlock={readyBlock}
            copyAction={copyAction}
            siteId={siteId}
            label={global.label}
            uiStatus={uiStatus}
            backendStatus={entry.status}
            scheduledAt={entry.scheduledAt}
            editedSinceReady={editedSinceReady}
            saveStatus={editor.status}
            conflict={editor.conflict}
            lastSavedAt={editor.lastSavedAt}
            updatedAt={entry.updatedAt}
            errorCount={editor.errorCount}
            onSave={() => void editor.save()}
            canManage={canManage}
            canSchedule={canSchedule}
            busy={editor.busy}
            markReadyPending={editor.markReadyPending}
            markable={editor.markable}
            hasReady={hasReady}
            canDiscard={canDiscard}
            discardPending={editor.discardPending}
            onMarkReady={editor.markReady}
            onDiscard={() => void editor.discard().catch(() => undefined)}
            discardReason={discardReason}
            previewAvailable={previewAvailable}
            previewUrl={editor.previewUrl}
            previewReason={previewReason}
            onPreview={openPreview}
            scheduled={entry.status === 'scheduled'}
            scheduleOpen={scheduleOpen}
            onScheduleOpenChange={setScheduleOpen}
            schedulePending={editor.schedulePending}
            scheduleInitialAt={
              entry.scheduledAt ? new Date(entry.scheduledAt) : null
            }
            scheduleInitialTimeZone={entry.scheduleTimezone}
            onScheduleSubmit={async (at, timeZone) => {
              // A form opened before the conflict must not approve over it.
              if (editor.conflict) return
              const result = await editor
                .schedule(at, timeZone)
                .catch(() => null)
              if (result) setScheduleOpen(false)
            }}
            onCancelSchedule={editor.cancelSchedule}
            onOpenHistory={() => setHistoryOpen(true)}
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

          {translate.dialog}

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
