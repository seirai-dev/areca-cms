import * as React from 'react'
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import { useDraftRecovery } from './draft-recovery'
import { authClient } from '#/lib/auth-client'
import { readLocale, writeLocale } from '#/lib/content-locale'
import { isValidSlug } from '#/lib/slug'
import type { LocaleCtx } from '#/lib/content-locale'
import { OVERVIEW_ENTRIES, queryKeys } from '#/lib/content/query-keys'
import { entryQuery as entryOptions } from '#/lib/content/queries'
import {
  errorMessage,
  fieldErrorsFromUnknown,
  firstTextField,
  initialEntryData,
  slugify,
} from '#/lib/content/utils'
import type { FieldErrorMap } from '#/lib/content/utils'
import { isEditedSinceReady } from '#/features/golive/entry-live-state'
import { invalidateGoLiveKeys, useGoLive } from '#/features/golive/use-go-live'
import { invalidateDevSync } from '#/features/dev-env/invalidate'
import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import type { LocaleBlocker } from './language-state'
import { scheduledPollInterval } from './editor-timing'
import type { SaveTrigger } from './save-intent'
import { useAutosave } from './use-autosave'
import type { SaveContext, SaveOutcome } from './use-autosave'
import { useEntryAction } from './use-entry-action'
import type { EntryActionDeps } from './use-entry-action'
import type { listRevisionsFn } from '#/server/fn/content'
import {
  archiveEntryFn,
  cancelScheduleFn,
  createEntryFn,
  deleteEntryFn,
  discardGlobalDraftFn,
  getEntryFn,
  getGlobalPreviewUrlFn,
  getPreviewUrlFn,
  publishEntryFn,
  applySectionLinkUpdatesFn,
  restoreRevisionFn,
  scheduleEntryFn,
  unpublishEntryFn,
  updateDraftFn,
  updateGlobalDraftFn,
} from '#/server/fn/content'
import type {
  SectionChangeWithLinks,
  SectionLinkUpdate,
} from '#/server/content/section-link-updates'

/** An entry as the editor loads it. */
export type EntryRecord = Awaited<ReturnType<typeof getEntryFn>>

/** A save's response: the draft without the ready and scheduled copies. */
type SaveResult =
  | Awaited<ReturnType<typeof updateDraftFn>>
  | Awaited<ReturnType<typeof updateGlobalDraftFn>>
  | Awaited<ReturnType<typeof createEntryFn>>

export type RevisionRecord = Awaited<
  ReturnType<typeof listRevisionsFn>
>['items'][number]

/**
 * - `idle`    nothing saved in this session yet
 * - `saving`  a save is in flight
 * - `saved`   the last save succeeded
 * - `failed`  the last save failed (validation or network)
 * - `blocked` a new entry cannot be created yet: it has no valid slug
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'blocked'

/**
 * The draft moved on the server. `save`: a save was refused; the local edits
 * are kept on offer. `approval`: Mark ready or Schedule was refused, because
 * the draft changed after review; nothing was approved. Either blocks saving
 * until the latest version is loaded.
 */
export type DraftConflict = 'save' | 'approval' | null

/** A record the server returned with the entry's draft in it. */
type ServerDraft = Pick<EntryRecord, 'id' | 'draftData' | 'draftVersion'>

function payloadFromData(data: EntryData) {
  const next: EntryData = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    next[key] = value
  }
  return next
}

function importWarnings(result: unknown): string[] {
  if (typeof result !== 'object' || result === null) return []
  const warnings = (result as { importWarnings?: unknown }).importWarnings
  return Array.isArray(warnings) ? warnings : []
}

/**
 * Everything the editor does, without markup (brief §3.5, §5.2):
 *
 * - loads the entry, its revisions and the signed preview URL;
 * - keeps the local draft, the slug-follows-title rule and field errors;
 * - autosaves (use-autosave.ts) and keeps a browser copy for crash recovery
 *   (draft-recovery.ts); a new entry is created on the first save that has a
 *   valid slug;
 * - the entry actions (mark as ready, go live now, schedule, cancel, move
 *   back to draft, archive, delete, restore), each flushing the draft first.
 */
export function useEntryEditor({
  siteId,
  collectionKey,
  globalKey,
  fields,
  entryId: routeEntryId,
  onCreated,
  onDeleted,
  onRevealError,
  previewRefetchInterval,
}: {
  siteId: string
  collectionKey: string
  /**
   * Site content (globals): the section key. The editor then saves through
   * the section functions, previews the section and can discard its draft.
   * `entryId` is then the section's one entry, which always exists.
   */
  globalKey?: string
  fields: Field[]
  entryId?: string
  /** A new entry got its server row; the host swaps the URL. */
  onCreated?: (id: string) => Promise<unknown> | void
  onDeleted?: () => Promise<unknown> | void
  /** Bring a field with an error into view. */
  onRevealError?: (fieldKey: string) => void
  /**
   * Refetch the signed preview URL every this many ms (Visual mode keeps its
   * token fresh; tokens last an hour). Off when omitted.
   */
  previewRefetchInterval?: number
}) {
  const sessionQuery = authClient.useSession()
  const recoveryUserId = sessionQuery.data?.user.id
  const queryClient = useQueryClient()
  const goLive = useGoLive(siteId)

  const [createdId, setCreatedId] = React.useState<string | undefined>()
  const [restoreSkippedFields, setRestoreSkippedFields] = React.useState<
    Array<{ key: string; label: string; reason: string }>
  >([])
  const entryId = routeEntryId ?? createdId
  const entryIdRef = React.useRef(entryId)
  entryIdRef.current = entryId

  const titleField = firstTextField(fields)
  const slugField = fields.find((field) => field.type === 'slug')

  const entryQuery = useQuery({
    ...entryOptions(entryId ?? 'new'),
    enabled: Boolean(entryId),
    // While editing, a focus refetch is wasted: the DRAFT_CONFLICT version
    // check already protects against a concurrent edit.
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.status === 'scheduled'
        ? scheduledPollInterval(data.scheduledAt, Date.now())
        : false
    },
  })
  const entry = entryQuery.data ?? null

  const previewQuery = useQuery({
    queryKey: globalKey
      ? (['global-preview', siteId, globalKey] as const)
      : queryKeys.previewUrl(siteId, collectionKey, entry?.slug ?? ''),
    queryFn: () =>
      globalKey
        ? getGlobalPreviewUrlFn({ data: { siteId, key: globalKey } })
        : getPreviewUrlFn({
            data: { siteId, collection: collectionKey, slug: entry!.slug },
          }),
    enabled: globalKey ? Boolean(entry) : Boolean(entry?.slug),
    staleTime: 5 * 60 * 1000,
    refetchInterval: previewRefetchInterval ?? false,
  })

  /* ----------------------------------------------------------------------
     Local draft
  ---------------------------------------------------------------------- */

  const [data, setDataState] = React.useState<EntryData>(() =>
    initialEntryData(fields),
  )
  const dataRef = React.useRef(data)
  const initialJson = React.useMemo(
    () => JSON.stringify(initialEntryData(fields)),
    [fields],
  )
  const baselineRef = React.useRef(initialJson)
  const [baseline, setBaselineState] = React.useState(initialJson)
  const serverJsonRef = React.useRef<string | null>(null)
  const [hydratedId, setHydratedId] = React.useState<string | undefined>()
  const [slugManual, setSlugManual] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrorMap>({})
  /** Language gaps the server refused a ready or schedule for (multilingual sites). */
  const [serverBlockers, setServerBlockers] = React.useState<LocaleBlocker[]>(
    [],
  )
  const [formError, setFormError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<SaveStatus>('idle')
  const versionRef = React.useRef<number>(1)
  const [conflict, setConflictState] = React.useState<DraftConflict>(null)
  const conflictRef = React.useRef<DraftConflict>(null)
  const setConflict = React.useCallback((next: DraftConflict) => {
    conflictRef.current = next
    setConflictState(next)
  }, [])
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null)

  const setData = React.useCallback((next: EntryData) => {
    dataRef.current = next
    setDataState(next)
  }, [])
  const setBaseline = React.useCallback((json: string) => {
    baselineRef.current = json
    setBaselineState(json)
  }, [])
  const isDirtyNow = React.useCallback(
    () => JSON.stringify(dataRef.current) !== baselineRef.current,
    [],
  )

  // The one serialisation of the entry per change.
  const dirty = React.useMemo(
    () => JSON.stringify(data) !== baseline,
    [data, baseline],
  )

  const recovery = useDraftRecovery({
    key: `areca:draft:${recoveryUserId ?? 'pending'}:${siteId}:${collectionKey}:${entryId ?? 'new'}`,
    ready: Boolean(recoveryUserId) && !(entryId && hydratedId !== entryId),
    data,
    dirty,
    read: () => ({ data: dataRef.current, version: versionRef.current }),
    isDirty: isDirtyNow,
    baseline: () => baselineRef.current,
    onUnavailable: () => setFormError(m.editor_draft_recovery_unavailable()),
  })

  /** Take the server's draft, unless local edits are still unsaved. */
  const hydrate = React.useCallback(
    (record: ServerDraft, force: boolean) => {
      const next = initialEntryData(fields, record.draftData)
      const json = JSON.stringify(next)
      if (!force && json === serverJsonRef.current) return
      serverJsonRef.current = json
      if (force || !isDirtyNow()) {
        versionRef.current = record.draftVersion
        setData(next)
        setBaseline(json)
      }
    },
    [fields, isDirtyNow, setData, setBaseline],
  )

  /**
   * Makes a record the server returned the editor's copy: its draft (when
   * `take`), the cached entry, and no errors. Conflict and the recovery copy
   * are cleared only where the caller says so.
   */
  function adoptServerRecord(
    record: ServerDraft & Partial<EntryRecord>,
    options: { take: boolean; clearConflict: boolean; clearRecovery: boolean },
  ) {
    if (options.take) hydrate(record, true)
    if (options.clearConflict) setConflict(null)
    if (options.clearRecovery) recovery.clear()
    setFieldErrors({})
    setFormError(null)
    queryClient.setQueryData(
      queryKeys.entry(record.id),
      (old: EntryRecord | undefined) => ({ ...old, ...record }),
    )
  }

  React.useEffect(() => {
    if (!entry) return
    if (hydratedId !== entry.id) {
      hydrate(entry, true)
      setConflict(null)
      // A never-published draft whose slug still matches its title keeps
      // following the title; anything else keeps its address.
      const title = titleField ? entry.draftData[titleField.key] : undefined
      const follows =
        entry.status === 'draft' &&
        !entry.publishedAt &&
        typeof title === 'string' &&
        slugify(title) === entry.slug
      setSlugManual(!follows)
      setHydratedId(entry.id)
      return
    }
    hydrate(entry, false)
  }, [entry, hydratedId, hydrate, titleField, setConflict])

  /** Stores `next` as the whole entry, clearing errors for the touched keys. */
  const commitData = React.useCallback(
    (next: EntryData, touched: string[]) => {
      setServerBlockers((current) => (current.length > 0 ? [] : current))
      setData(next)
      setFieldErrors((errors) => {
        const stale = Object.keys(errors).filter((path) =>
          touched.some((item) => path === item || path.startsWith(`${item}.`)),
        )
        if (stale.length === 0) return errors
        const copy = { ...errors }
        for (const item of stale) delete copy[item]
        return copy
      })
    },
    [setData],
  )

  const updateField = React.useCallback(
    (key: string, value: unknown) => {
      const prev = dataRef.current
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
      if (slugField && key === slugField.key) setSlugManual(true)
      commitData(next, [
        key,
        ...(slugField && key === titleField?.key && !slugManual
          ? [slugField.key]
          : []),
      ])
    },
    [slugManual, slugField, titleField, commitData],
  )

  /**
   * Writes one language of the entry (content languages). Shared fields and
   * the other languages are left as they are. Use `updateField` for the main
   * language, which also keeps the slug in step with the title.
   */
  const updateLocaleFields = React.useCallback(
    (patch: EntryData, locale: string, ctx: LocaleCtx) => {
      const prev = dataRef.current
      const next = writeLocale(
        prev,
        locale,
        { ...readLocale(prev, locale, ctx), ...patch },
        ctx,
      )
      commitData(next, Object.keys(patch))
    },
    [commitData],
  )

  /** One key of `updateLocaleFields`. */
  const updateLocaleField = React.useCallback(
    (key: string, value: unknown, locale: string, ctx: LocaleCtx) =>
      updateLocaleFields({ [key]: value }, locale, ctx),
    [updateLocaleFields],
  )

  function resetSlugFromTitle() {
    if (!slugField || !titleField) return
    const title = dataRef.current[titleField.key]
    setSlugManual(false)
    setData({
      ...dataRef.current,
      [slugField.key]: slugify(typeof title === 'string' ? title : ''),
    })
  }

  /* ----------------------------------------------------------------------
     Saving
  ---------------------------------------------------------------------- */

  /** Headings that links point to and the last explicit save changed (decision 21). */
  const [sectionChanges, setSectionChanges] = React.useState<
    SectionChangeWithLinks[]
  >([])
  // A different entry is a different set of changes.
  React.useEffect(() => {
    setSectionChanges([])
  }, [routeEntryId])
  const fieldsRef = React.useRef(fields)
  fieldsRef.current = fields
  const onCreatedRef = React.useRef(onCreated)
  onCreatedRef.current = onCreated
  const onRevealRef = React.useRef(onRevealError)
  onRevealRef.current = onRevealError

  // Each external image that could not be copied is reported once, not on
  // every autosave.
  const warnedImagesRef = React.useRef(new Set<string>())
  const warnImageImports = React.useCallback((result: unknown) => {
    for (const warning of importWarnings(result)) {
      if (warnedImagesRef.current.has(warning)) continue
      warnedImagesRef.current.add(warning)
      toast.warning(warning)
    }
  }, [])

  const reveal = React.useCallback((errors: FieldErrorMap) => {
    const first = fieldsRef.current.find((field) => errors[field.key])
    if (first) onRevealRef.current?.(first.key)
  }, [])

  /**
   * Marks the entry's lists, revisions and release state stale. With
   * `refetch` the active ones reload now (milestone actions). Without it they
   * only reload when next shown, so an autosave does not refetch them every few
   * seconds. The dev sync count always reloads: it is shown on the editor's dev
   * banner and a draft save changes it.
   */
  const invalidateLists = React.useCallback(
    (id?: string, refetch = true) => {
      const refetchType = refetch ? 'active' : 'none'
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['entries', siteId, collectionKey],
          refetchType,
        }),
        queryClient.invalidateQueries({
          queryKey: ['entries', siteId, OVERVIEW_ENTRIES],
          refetchType,
        }),
        id
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.revisions(id),
              refetchType,
            })
          : null,
        invalidateDevSync(queryClient, siteId),
        invalidateGoLiveKeys(queryClient, siteId, refetchType),
        // Dead entry links are checked again after every save, autosaves
        // included. Only queries in use refetch, so entries without entry
        // links make no request.
        queryClient.invalidateQueries({
          queryKey: queryKeys.linkTargets(siteId),
          refetchType: 'active',
        }),
      ])
    },
    [queryClient, siteId, collectionKey],
  )

  /**
   * Sends the draft. Only an explicit entry save reports the headings that
   * links point to and that it changed; sections and new entries report none.
   */
  async function submit(
    id: string | undefined,
    payload: EntryData,
    explicit: boolean,
  ): Promise<{
    saved: SaveResult
    linkedSections: SectionChangeWithLinks[]
  }> {
    const expectedVersion = versionRef.current
    if (globalKey) {
      const saved = await updateGlobalDraftFn({
        data: { siteId, key: globalKey, data: payload, expectedVersion },
      })
      return { saved, linkedSections: [] }
    }
    if (!id) {
      const saved = await createEntryFn({
        data: { siteId, collectionKey, data: payload },
      })
      return { saved, linkedSections: [] }
    }
    const saved = await updateDraftFn({
      data: { id, data: payload, expectedVersion, explicit },
    })
    return { saved, linkedSections: saved.sectionChanges }
  }

  async function saveOnce(save: SaveContext): Promise<SaveOutcome> {
    if (conflictRef.current) return 'failed'
    const snapshot = dataRef.current
    const submitted = JSON.stringify(snapshot)
    const id = entryIdRef.current
    if (globalKey && !id) {
      setStatus('blocked')
      return 'blocked'
    }
    if (!id) {
      const slug = slugField ? snapshot[slugField.key] : undefined
      if (typeof slug !== 'string' || !isValidSlug(slug)) {
        setStatus('blocked')
        return 'blocked'
      }
    }
    setStatus('saving')
    const explicit = save.explicit()
    try {
      const { saved, linkedSections } = await submit(
        id,
        payloadFromData(snapshot),
        explicit,
      )
      versionRef.current = saved.draftVersion
      if (explicit) {
        setSectionChanges(linkedSections)
        // The headings may have moved, so "Linked from" reads the section again.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.linkedFrom(saved.id),
        })
      }
      serverJsonRef.current = JSON.stringify(
        initialEntryData(fieldsRef.current, saved.draftData),
      )
      const settled = JSON.stringify(dataRef.current) === submitted
      // The server may store a different copy of the draft: it swaps external
      // images for library copies and rewrites entry links. Show that copy, so
      // Mark ready compares what the editor shows with what was saved. With
      // newer local edits the next save receives the same changes.
      const normalised = serverJsonRef.current !== submitted
      const imported = 'importedImages' in saved && saved.importedImages > 0
      const take = (normalised || imported) && settled
      adoptServerRecord(saved, {
        take,
        clearConflict: false,
        clearRecovery: settled,
      })
      if (!take) setBaseline(submitted)
      warnImageImports(saved)
      setLastSavedAt(new Date())
      setStatus('saved')
      // A save is not a milestone: the lists reload when next shown.
      void invalidateLists(saved.id, false)
      if (!id) {
        // The first save creates the entry, so the sidebar's counts change.
        // Later autosaves leave them alone.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.entryCounts(siteId),
        })
        entryIdRef.current = saved.id
        setCreatedId(saved.id)
        setHydratedId(saved.id)
        if (!save.leaving()) {
          save.bypassUntil(Promise.resolve(onCreatedRef.current?.(saved.id)))
        }
      }
      return 'saved'
    } catch (error) {
      // A conflict is not a field problem. The conflict notice explains it, so
      // the message must not be parsed into a fake field error ("fix 1 field").
      if (
        errorMessage(error, m.editor_could_not_save()).includes(
          'DRAFT_CONFLICT',
        )
      ) {
        setConflict('save')
        recovery.setRecovered(dataRef.current)
        setFieldErrors({})
        setFormError(null)
        setStatus('failed')
        return 'failed'
      }
      const parsed = fieldErrorsFromUnknown(error)
      setFieldErrors(parsed.fieldErrors)
      const hasFieldErrors = Object.keys(parsed.fieldErrors).some(Boolean)
      setFormError(
        parsed.formError ??
          (hasFieldErrors
            ? null
            : errorMessage(error, m.editor_could_not_save())),
      )
      setStatus('failed')
      if (save.explicit()) reveal(parsed.fieldErrors)
      return 'failed'
    }
  }

  const autosave = useAutosave({
    data,
    dirty,
    isDirty: isDirtyNow,
    save: saveOnce,
    beforeLeave: recovery.flush,
  })
  const flush = autosave.flush

  /* ----------------------------------------------------------------------
     Actions
  ---------------------------------------------------------------------- */

  const invalidateEntry = React.useCallback(
    async (id: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.entry(id) }),
        invalidateLists(id),
      ])
    },
    [queryClient, invalidateLists],
  )

  /** Flush before an action; false (with a toast) when it could not save. */
  async function ensureSaved(trigger: SaveTrigger = 'action') {
    const outcome = await flush(trigger)
    if (outcome === 'saved' && entryIdRef.current) return entryIdRef.current
    toast.error(
      outcome === 'blocked'
        ? m.editor_add_title_first()
        : m.editor_fix_fields_first(),
    )
    return null
  }

  function actionError(
    fallback: ReturnType<typeof m.editor_something_went_wrong>,
  ) {
    return (error: unknown) => {
      const parsed = fieldErrorsFromUnknown(error)
      if (Object.keys(parsed.fieldErrors).some(Boolean)) {
        setFieldErrors(parsed.fieldErrors)
        reveal(parsed.fieldErrors)
      }
      const blockers = (error as { blockers?: unknown } | null)?.blockers
      if (Array.isArray(blockers) && blockers.length > 0) {
        setServerBlockers(blockers as LocaleBlocker[])
      }
      toast.error(parsed.formError ?? errorMessage(error, fallback))
    }
  }

  /**
   * A conflict means the draft moved after the reviewer opened it. Nothing was
   * approved, so the editor blocks further saves until the latest version is loaded.
   */
  function approvalError(
    fallback: ReturnType<typeof m.editor_something_went_wrong>,
  ) {
    const failed = actionError(fallback)
    return (error: unknown) => {
      if (errorMessage(error, fallback).includes('DRAFT_CONFLICT')) {
        setConflict('approval')
        return
      }
      failed(error)
    }
  }

  // The actions `busy` waits for share this key.
  const actionKey = ['entry-action', React.useId()] as const
  const actionDeps: EntryActionDeps = {
    mutationKey: actionKey,
    ensureSaved,
    currentId: () => entryIdRef.current,
    invalidateEntry,
  }

  /** Points links at the sections a save changed (decision 21). */
  const applySectionChangesMutation = useMutation({
    mutationFn: async (updates: SectionLinkUpdate[]) => {
      const id = entryIdRef.current
      if (!id) return null
      return applySectionLinkUpdatesFn({ data: { id, updates } })
    },
    onSuccess: async (result) => {
      if (!result) return
      setSectionChanges([])
      const id = entryIdRef.current
      if (!id) return
      await queryClient.invalidateQueries({
        queryKey: queryKeys.linkedFrom(id),
      })
      // The entry itself may be one of the updated links (a link to its own section).
      if (result.updated.some((updated) => updated.id === id)) {
        await invalidateEntry(id)
      }
      void invalidateLists(id)
      toast.success(m.editor_section_links_done())
    },
    onError: () => {
      toast.error(m.editor_section_links_failed())
    },
  })

  const markReadyMutation = useEntryAction<{ quiet?: boolean }>(actionDeps, {
    save: 'mark-ready',
    run: async (id) =>
      warnImageImports(
        await publishEntryFn({
          data: { id, expectedVersion: versionRef.current },
        }),
      ),
    success: (input) => {
      if (!input.quiet)
        toast.success(m.editor_marked_ready(), {
          description: m.editor_marked_ready_description(),
        })
    },
    error: approvalError(m.editor_could_not_mark_ready()),
  })

  const goLiveNowMutation = useMutation({
    mutationKey: actionKey,
    mutationFn: async (markFirst: boolean) => {
      if (markFirst) {
        const marked = await markReadyMutation.mutateAsync({ quiet: true })
        if (!marked) return null
      }
      return goLive.goLive()
    },
  })

  const scheduleMutation = useEntryAction<{ at: Date; timeZone: string }>(
    actionDeps,
    {
      save: 'action',
      run: async (id, input) =>
        warnImageImports(
          await scheduleEntryFn({
            data: {
              id,
              scheduledAt: input.at.toISOString(),
              timezone: input.timeZone,
              expectedVersion: versionRef.current,
            },
          }),
        ),
      success: () => toast.success(m.editor_scheduled_toast()),
      error: approvalError(m.editor_could_not_schedule()),
    },
  )

  const cancelScheduleMutation = useEntryAction(actionDeps, {
    save: 'none',
    run: (id) => cancelScheduleFn({ data: { id } }),
    success: () => toast.success(m.editor_schedule_cancelled()),
    error: actionError(m.editor_could_not_cancel_schedule()),
  })

  const unpublishMutation = useEntryAction(actionDeps, {
    save: 'action',
    run: (id) => unpublishEntryFn({ data: { id } }),
    success: () => toast.success(m.editor_moved_to_draft()),
    error: actionError(m.editor_could_not_unpublish()),
  })

  const archiveMutation = useEntryAction(actionDeps, {
    save: 'action',
    run: (id) => archiveEntryFn({ data: { id } }),
    success: () => toast.success(m.editor_entry_archived()),
    error: actionError(m.editor_could_not_archive()),
  })

  const deleteMutation = useMutation({
    mutationKey: actionKey,
    mutationFn: () => deleteEntryFn({ data: { id: entryIdRef.current! } }),
    onSuccess: async () => {
      toast.success(m.editor_entry_deleted())
      autosave.bypass()
      autosave.cancel()
      await Promise.all([
        invalidateLists(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.entryCounts(siteId),
        }),
      ])
      await onDeleted?.()
    },
    onError: actionError(m.editor_could_not_delete()),
  })

  /** Site content: back to the ready version. No confirmation, by design. */
  const discardMutation = useMutation({
    mutationKey: actionKey,
    mutationFn: async () => {
      autosave.cancel()
      // A save already in flight must land before the draft is replaced.
      await autosave.settled()
      return discardGlobalDraftFn({ data: { siteId, key: globalKey! } })
    },
    onSuccess: async (record) => {
      adoptServerRecord(record, {
        take: true,
        clearConflict: true,
        clearRecovery: true,
      })
      toast.success(m.globals_discarded())
      await invalidateEntry(record.id)
    },
    onError: actionError(m.globals_could_not_discard()),
  })

  const restoreMutation = useMutation({
    mutationKey: actionKey,
    mutationFn: async (revisionId: string) => {
      const id = await ensureSaved()
      if (!id)
        throw new Error(m.editor_save_or_resolve_conflict_before_restore())
      return restoreRevisionFn({
        data: {
          entryId: id,
          revisionId,
          expectedVersion: versionRef.current,
        },
      })
    },
    onSuccess: async (restored) => {
      // Restoring needs a clean save first, so there is no conflict and no
      // recovery copy to clear.
      adoptServerRecord(restored, {
        take: true,
        clearConflict: false,
        clearRecovery: false,
      })
      setRestoreSkippedFields(restored.skippedFields)
      if (restored.skippedFields.length)
        toast.warning(m.editor_revision_restored_partial())
      else toast.success(m.editor_revision_restored())
      await invalidateEntry(restored.id)
    },
    onError: actionError(m.editor_could_not_restore()),
  })

  /* ----------------------------------------------------------------------
     Derived state
  ---------------------------------------------------------------------- */

  const isNew = !entryId
  const errorCount = Object.keys(fieldErrors).filter(Boolean).length
  /** True when Mark ready has something to approve in `draft`. */
  const isMarkable = React.useCallback(
    (draft: EntryData) =>
      entry
        ? entry.status !== 'published' ||
          isEditedSinceReady({
            status: entry.status,
            updatedAt: entry.updatedAt,
            draftData: initialEntryData(fields, draft),
            publishedData: entry.publishedData
              ? initialEntryData(fields, entry.publishedData)
              : entry.publishedData,
          })
        : true,
    [entry, fields],
  )
  // Compares two serialisations on a published entry; kept out of the
  // keystroke's render. Actions read the current draft (`isMarkable`).
  const deferredData = React.useDeferredValue(data)
  const markable = React.useMemo(
    () => isMarkable(deferredData),
    [isMarkable, deferredData],
  )
  const busy = useIsMutating({ mutationKey: actionKey }) > 0
  const loading =
    Boolean(routeEntryId) &&
    (entryQuery.isLoading || hydratedId !== routeEntryId)
  const ready = Boolean(entry) && hydratedId === entryId && status !== 'saving'

  /**
   * Loads the latest server draft after a conflict. `reapply` puts the local
   * edits back on top; otherwise they stay on offer.
   */
  async function resolveDraftConflict(reapply: boolean) {
    const local = recovery.recovered ?? (isDirtyNow() ? dataRef.current : null)
    const id = entryIdRef.current
    if (id) {
      adoptServerRecord(await getEntryFn({ data: { id } }), {
        take: true,
        clearConflict: true,
        clearRecovery: false,
      })
    } else {
      // A new entry has no server draft, only the recovered copy to decide on.
      setConflict(null)
      setFormError(null)
    }
    setStatus('idle')
    if (reapply && local) {
      setData(local)
      recovery.setRecovered(null)
    } else {
      recovery.setRecovered(local)
    }
  }

  return {
    sectionChanges,
    dismissSectionChanges: () => setSectionChanges([]),
    applySectionChanges: (updates: SectionLinkUpdate[]) =>
      applySectionChangesMutation.mutateAsync(updates),
    applyingSectionChanges: applySectionChangesMutation.isPending,
    conflict,
    recoveredDraft: recovery.recovered,
    reloadServerDraft: () => resolveDraftConflict(false),
    reapplyRecoveredDraft: () => resolveDraftConflict(true),
    discardRecoveredDraft: recovery.clear,
    entryId,
    isNew,
    entry,
    entryQuery,
    loading,
    ready,
    previewUrl: previewQuery.data?.url,
    titleField,
    slugField,
    data,
    updateField,
    updateLocaleField,
    updateLocaleFields,
    serverBlockers,
    slugManual,
    resetSlugFromTitle,
    fieldErrors,
    errorCount,
    formError,
    dirty,
    status,
    lastSavedAt,
    save: () => flush('save'),
    persist: () => flush('background'),
    markable,
    busy,
    markReady: () => markReadyMutation.mutate({}),
    markReadyPending: markReadyMutation.isPending,
    goLiveNow: () => goLiveNowMutation.mutateAsync(isMarkable(dataRef.current)),
    goLiveNowPending: goLiveNowMutation.isPending || goLive.isPending,
    schedule: (at: Date, timeZone: string) =>
      scheduleMutation.mutateAsync({ at, timeZone }),
    schedulePending: scheduleMutation.isPending,
    cancelSchedule: () => cancelScheduleMutation.mutate(),
    unpublish: () => unpublishMutation.mutate(),
    archive: () => archiveMutation.mutate(),
    remove: () => deleteMutation.mutateAsync(),
    restore: (revisionId: string) => restoreMutation.mutateAsync(revisionId),
    discard: () => discardMutation.mutateAsync(),
    discardPending: discardMutation.isPending,
    restoreSkippedFields,
    blocker: autosave.blocker,
    leaveAnyway: autosave.leaveAnyway,
  }
}

export type EntryEditorState = ReturnType<typeof useEntryEditor>
