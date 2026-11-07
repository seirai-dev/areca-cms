import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { toast } from 'sonner'

import {
  persistDraft,
  readRecoveredDraft,
  shouldKeepEditorOpen,
} from './draft-recovery'
import { authClient } from '#/lib/auth-client'
import { readLocale, writeLocale } from '#/lib/content-locale'
import { isValidSlug } from '#/lib/slug'
import type { LocaleCtx } from '#/lib/content-locale'
import { OVERVIEW_ENTRIES, queryKeys } from '#/lib/content/query-keys'
import {
  errorMessage,
  fieldErrorsFromUnknown,
  firstTextField,
  initialEntryData,
  slugify,
} from '#/lib/content/utils'
import type { FieldErrorMap } from '#/lib/content/utils'
import { isEditedSinceReady } from '#/features/golive/entry-live-state'
import {
  invalidateGoLiveKeys,
  useGoLive,
  useInvalidateGoLive,
} from '#/features/golive/use-go-live'
import { invalidateDevSync } from '#/features/dev-env/invalidate'
import type { EntryData, EntryStatus, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import type { LocaleBlocker } from './language-state'
import { autosaveDelay, scheduledPollInterval } from './editor-timing'
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

/** Navigation waits at most this long for a pending save. */
const LEAVE_WAIT = 3000

export type EntryRecord = {
  id: string
  slug: string
  status: EntryStatus
  draftVersion: number
  scheduledSlug?: string | null
  scheduledData?: EntryData | null
  draftData: EntryData
  publishedData?: EntryData | null
  scheduledAt: string | Date | null
  scheduleTimezone?: string | null
  publishedAt: string | Date | null
  createdAt: string | Date
  updatedAt: string | Date
  createdBy?: string | null
  createdByName?: string | null
  updatedByName?: string | null
}

/** Save and approve responses: external images copied into the media library. */
type ImageImportResult = {
  importedImages?: number
  importWarnings?: string[]
}

/** A save's response: the entry, plus the headings links point to that it changed. */
type SaveResult = EntryRecord &
  ImageImportResult & { sectionChanges?: SectionChangeWithLinks[] }

export type RevisionRecord = {
  id: string
  createdAt: string | Date
  note: string | null
  createdBy?: string | null
  createdByName?: string | null
}

/**
 * - `idle`    nothing saved in this session yet
 * - `saving`  a save is in flight
 * - `saved`   the last save succeeded
 * - `failed`  the last save failed (validation or network)
 * - `blocked` a new entry cannot be created yet: it has no valid slug
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'blocked'
type Outcome = 'saved' | 'failed' | 'blocked'

function payloadFromData(data: EntryData) {
  const next: EntryData = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    next[key] = value
  }
  return next
}

const sleep = (ms: number) =>
  new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))

/**
 * Everything the editor does, without markup (brief §3.5, §5.2):
 *
 * - loads the entry, its revisions and the signed preview URL;
 * - keeps the local draft, the slug-follows-title rule and field errors;
 * - **autosave**: 3s after the last change, but at most 10s after the first
 *   unsaved change while typing; also on window blur / tab hide, before
 *   navigation (up to 3s) and on ⌘S; one save in flight, edits made
 *   meanwhile are kept and saved next; a new entry is created on the first
 *   save that has a valid slug;
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
  const invalidateGoLive = useInvalidateGoLive(siteId)
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
    queryKey: queryKeys.entry(entryId ?? 'new'),
    queryFn: () => getEntryFn({ data: { id: entryId! } }),
    enabled: Boolean(entryId),
    // While editing, a focus refetch is wasted: the DRAFT_CONFLICT version
    // check already protects against a concurrent edit.
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const data = query.state.data as EntryRecord | undefined
      return data?.status === 'scheduled'
        ? scheduledPollInterval(data.scheduledAt, Date.now())
        : false
    },
  })
  const entry = (entryQuery.data ?? null) as EntryRecord | null

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
  const conflictRef = React.useRef(false)
  const [conflict, setConflict] = React.useState(false)
  /** The conflict came from Mark ready or Schedule: the draft moved after review. */
  const [approvalConflict, setApprovalConflict] = React.useState(false)
  const [recoveredDraft, setRecoveredDraft] = React.useState<EntryData | null>(
    null,
  )
  const recoveryKey = `areca:draft:${recoveryUserId ?? 'pending'}:${siteId}:${collectionKey}:${entryId ?? 'new'}`
  const recoveryKeyRef = React.useRef(recoveryKey)
  recoveryKeyRef.current = recoveryKey
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

  const dataJson = JSON.stringify(data)
  const dirty = dataJson !== baseline

  React.useEffect(() => {
    if (!dirty || !recoveryUserId || (entryId && hydratedId !== entryId)) return
    try {
      persistDraft(localStorage, recoveryKey, data, versionRef.current)
    } catch {
      setFormError(m.editor_draft_recovery_unavailable())
    }
  }, [dataJson, dirty, recoveryKey, recoveryUserId, entryId, hydratedId])

  React.useEffect(() => {
    setRecoveredDraft(null)
    if (!recoveryUserId || (entryId && hydratedId !== entryId)) return
    const recovery = readRecoveredDraft(localStorage, recoveryKey)
    if (recovery && JSON.stringify(recovery) !== baselineRef.current)
      setRecoveredDraft(recovery)
  }, [recoveryKey, recoveryUserId, entryId, hydratedId])

  /** Take the server's draft, unless local edits are still unsaved. */
  const hydrate = React.useCallback(
    (record: EntryRecord, force: boolean) => {
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

  React.useEffect(() => {
    if (!entry) return
    if (hydratedId !== entry.id) {
      hydrate(entry, true)
      conflictRef.current = false
      setConflict(false)
      setApprovalConflict(false)
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
  }, [entry, hydratedId, hydrate, titleField])

  /** Stores `next` as the whole entry, clearing errors for the touched keys. */
  const commitData = React.useCallback(
    (next: EntryData, touched: string[]) => {
      setServerBlockers((current) => (current.length > 0 ? [] : current))
      setData(next)
      try {
        persistDraft(
          localStorage,
          recoveryKeyRef.current,
          next,
          versionRef.current,
        )
      } catch {
        setFormError(m.editor_draft_recovery_unavailable())
      }
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
    updateFieldRaw(
      slugField.key,
      slugify(typeof title === 'string' ? title : ''),
    )
  }

  function updateFieldRaw(key: string, value: unknown) {
    const next = { ...dataRef.current, [key]: value }
    setData(next)
    try {
      persistDraft(
        localStorage,
        recoveryKeyRef.current,
        next,
        versionRef.current,
      )
    } catch {
      setFormError(m.editor_draft_recovery_unavailable())
    }
  }

  /* ----------------------------------------------------------------------
     Autosave
  ---------------------------------------------------------------------- */

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** When the first change not yet saved was made; null when none is pending. */
  const firstChangeAtRef = React.useRef<number | null>(null)
  const runningRef = React.useRef<Promise<Outcome> | null>(null)
  const pendingRef = React.useRef(false)
  /** The running save was asked for (⌘S, Save, an action), not a timer. */
  const explicitRef = React.useRef(false)
  /** The last save that went through was an autosave: an explicit save must still run. */
  const unexplicitSaveRef = React.useRef(false)
  const explicitSaveDue = () => explicitRef.current && unexplicitSaveRef.current
  /** Headings that links point to and the last explicit save changed (decision 21). */
  const [sectionChanges, setSectionChanges] = React.useState<
    SectionChangeWithLinks[]
  >([])
  // A different entry is a different set of changes.
  React.useEffect(() => {
    setSectionChanges([])
  }, [routeEntryId])
  const leavingRef = React.useRef(false)
  const bypassRef = React.useRef(false)
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
    const warnings = (result as ImageImportResult | null)?.importWarnings ?? []
    for (const warning of warnings) {
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

  const saveOnce = React.useCallback(async (): Promise<Outcome> => {
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
    const explicit = explicitRef.current
    try {
      const payload = payloadFromData(snapshot)
      const saved = (
        globalKey
          ? await updateGlobalDraftFn({
              data: {
                siteId,
                key: globalKey,
                data: payload,
                expectedVersion: versionRef.current,
              },
            })
          : id
            ? await updateDraftFn({
                data: {
                  id,
                  data: payload,
                  expectedVersion: versionRef.current,
                  explicit,
                },
              })
            : await createEntryFn({
                data: { siteId, collectionKey, data: payload },
              })
      ) as SaveResult
      versionRef.current = saved.draftVersion
      unexplicitSaveRef.current = !explicit
      if (explicit) {
        setSectionChanges(saved.sectionChanges ?? [])
        // The headings may have moved, so "Linked from" reads the section again.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.linkedFrom(saved.id),
        })
      }
      const serverData = initialEntryData(fieldsRef.current, saved.draftData)
      serverJsonRef.current = JSON.stringify(serverData)
      const settled = JSON.stringify(dataRef.current) === submitted
      if ((saved.importedImages ?? 0) > 0 && settled) {
        // The server swapped external images for library copies: show them.
        // With newer local edits the next save receives the same swap.
        setData(serverData)
        setBaseline(serverJsonRef.current)
      } else {
        setBaseline(submitted)
      }
      warnImageImports(saved)
      if (settled) {
        try {
          localStorage.removeItem(recoveryKeyRef.current)
        } catch {
          /* best effort */
        }
        setRecoveredDraft(null)
      }
      setFieldErrors({})
      setFormError(null)
      setLastSavedAt(new Date())
      setStatus('saved')
      queryClient.setQueryData(
        queryKeys.entry(saved.id),
        (old: EntryRecord | undefined) => ({
          ...old,
          ...saved,
        }),
      )
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
        if (!leavingRef.current) {
          bypassRef.current = true
          void Promise.resolve(onCreatedRef.current?.(saved.id)).finally(() => {
            bypassRef.current = false
          })
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
        conflictRef.current = true
        setConflict(true)
        setRecoveredDraft(dataRef.current)
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
      if (explicitRef.current) reveal(parsed.fieldErrors)
      return 'failed'
    }
  }, [
    slugField,
    siteId,
    collectionKey,
    globalKey,
    queryClient,
    setBaseline,
    setData,
    invalidateLists,
    reveal,
    warnImageImports,
  ])

  const requested = () => pendingRef.current
  const run = React.useCallback((): Promise<Outcome> => {
    if (runningRef.current) {
      pendingRef.current = true
      return runningRef.current
    }
    const loop = (async () => {
      // Yield first so `runningRef` is set before the loop can finish.
      await Promise.resolve()
      let outcome: Outcome = 'saved'
      try {
        do {
          pendingRef.current = false
          if (!isDirtyNow() && !explicitSaveDue()) break
          outcome = await saveOnce()
          if (outcome !== 'saved') break
        } while (requested() && (isDirtyNow() || explicitSaveDue()))
      } finally {
        runningRef.current = null
        explicitRef.current = false
      }
      return outcome
    })()
    runningRef.current = loop
    return loop
  }, [isDirtyNow, saveOnce])

  /** Save now (⌘S, Save, before actions and navigation). */
  const flush = React.useCallback((): Promise<Outcome> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    firstChangeAtRef.current = null
    explicitRef.current = true
    return run()
  }, [run])

  const runRef = React.useRef(run)
  runRef.current = run

  // Debounce: save 3s after the last change, and at most 10s after the first
  // unsaved change (see editor-timing.ts). Each change restarts the timer.
  React.useEffect(() => {
    if (!dirty) {
      firstChangeAtRef.current = null
      return
    }
    if (firstChangeAtRef.current === null) firstChangeAtRef.current = Date.now()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(
      () => {
        timerRef.current = null
        firstChangeAtRef.current = null
        void runRef.current()
      },
      autosaveDelay(Date.now(), firstChangeAtRef.current),
    )
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [dataJson, dirty])

  // Blur of the window or a hidden tab saves at once.
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && isDirtyNow()) void flush()
    }
    const onBlur = () => {
      if (isDirtyNow()) void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('blur', onBlur)
    }
  }, [flush, isDirtyNow])

  // Leaving: wait (max 3s) for the save; ask only when it could not save.
  const blocker = useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (bypassRef.current) return false
      if (current.pathname === next.pathname) return false
      if (!isDirtyNow() && !runningRef.current) return false
      leavingRef.current = true
      try {
        const outcome = await Promise.race([flush(), sleep(LEAVE_WAIT)])
        return shouldKeepEditorOpen(outcome, isDirtyNow())
      } finally {
        leavingRef.current = false
      }
    },
    enableBeforeUnload: () =>
      !bypassRef.current && (isDirtyNow() || Boolean(runningRef.current)),
    withResolver: true,
  })

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
  async function ensureSaved() {
    const outcome = await flush()
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
        conflictRef.current = true
        setConflict(true)
        setApprovalConflict(true)
        return
      }
      failed(error)
    }
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

  const markReadyMutation = useMutation({
    mutationFn: async (options: { quiet?: boolean } = {}) => {
      const id = await ensureSaved()
      if (!id) return null
      warnImageImports(
        await publishEntryFn({
          data: { id, expectedVersion: versionRef.current },
        }),
      )
      return { id, quiet: options.quiet }
    },
    onSuccess: async (result) => {
      if (!result) return
      if (!result.quiet)
        toast.success(m.editor_marked_ready(), {
          description: m.editor_marked_ready_description(),
        })
      await invalidateEntry(result.id)
    },
    onError: approvalError(m.editor_could_not_mark_ready()),
  })

  const goLiveNowMutation = useMutation({
    mutationFn: async (markFirst: boolean) => {
      if (markFirst) {
        const marked = await markReadyMutation.mutateAsync({ quiet: true })
        if (!marked) return null
      }
      return goLive.goLive()
    },
  })

  const scheduleMutation = useMutation({
    mutationFn: async (input: { at: Date; timeZone: string }) => {
      const id = await ensureSaved()
      if (!id) return null
      warnImageImports(
        await scheduleEntryFn({
          data: {
            id,
            scheduledAt: input.at.toISOString(),
            timezone: input.timeZone,
            expectedVersion: versionRef.current,
          },
        }),
      )
      return id
    },
    onSuccess: async (id) => {
      if (!id) return
      toast.success(m.editor_scheduled_toast())
      await invalidateEntry(id)
    },
    onError: approvalError(m.editor_could_not_schedule()),
  })

  const cancelScheduleMutation = useMutation({
    mutationFn: () => cancelScheduleFn({ data: { id: entryIdRef.current! } }),
    onSuccess: async () => {
      toast.success(m.editor_schedule_cancelled())
      await invalidateEntry(entryIdRef.current!)
    },
    onError: actionError(m.editor_could_not_cancel_schedule()),
  })

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      const id = await ensureSaved()
      if (!id) return null
      await unpublishEntryFn({ data: { id } })
      return id
    },
    onSuccess: async (id) => {
      if (!id) return
      toast.success(m.editor_moved_to_draft())
      await invalidateEntry(id)
    },
    onError: actionError(m.editor_could_not_unpublish()),
  })

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const id = await ensureSaved()
      if (!id) return null
      await archiveEntryFn({ data: { id } })
      return id
    },
    onSuccess: async (id) => {
      if (!id) return
      toast.success(m.editor_entry_archived())
      await invalidateEntry(id)
    },
    onError: actionError(m.editor_could_not_archive()),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteEntryFn({ data: { id: entryIdRef.current! } }),
    onSuccess: async () => {
      toast.success(m.editor_entry_deleted())
      bypassRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['entries', siteId, collectionKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ['entries', siteId, OVERVIEW_ENTRIES],
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.entryCounts(siteId),
        }),
        invalidateGoLive(),
      ])
      await onDeleted?.()
    },
    onError: actionError(m.editor_could_not_delete()),
  })

  /** Site content: back to the ready version. No confirmation, by design. */
  const discardMutation = useMutation({
    mutationFn: async () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // A save already in flight must land before the draft is replaced.
      await runningRef.current?.catch(() => undefined)
      return discardGlobalDraftFn({ data: { siteId, key: globalKey! } })
    },
    onSuccess: async (discarded) => {
      const record = discarded as EntryRecord
      hydrate(record, true)
      conflictRef.current = false
      setConflict(false)
      setApprovalConflict(false)
      setRecoveredDraft(null)
      setFieldErrors({})
      setFormError(null)
      try {
        localStorage.removeItem(recoveryKeyRef.current)
      } catch {
        /* best effort */
      }
      queryClient.setQueryData(
        queryKeys.entry(record.id),
        (old: EntryRecord | undefined) => ({ ...old, ...record }),
      )
      toast.success(m.globals_discarded())
      await invalidateEntry(record.id)
    },
    onError: actionError(m.globals_could_not_discard()),
  })

  const restoreMutation = useMutation({
    mutationFn: async (revisionId: string) => {
      const id = await ensureSaved()
      if (!id)
        throw new Error(m.editor_save_or_resolve_conflict_before_restore())
      const restored = await restoreRevisionFn({
        data: {
          entryId: entryIdRef.current!,
          revisionId,
          expectedVersion: versionRef.current,
        },
      })
      return restored
    },
    onSuccess: async (restored) => {
      hydrate(restored, true)
      setRestoreSkippedFields(restored.skippedFields)
      setFieldErrors({})
      setFormError(null)
      queryClient.setQueryData(
        queryKeys.entry(restored.id),
        (old: EntryRecord | undefined) => ({
          ...old,
          ...restored,
        }),
      )
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
  const markable = entry
    ? entry.status !== 'published' ||
      isEditedSinceReady({
        status: entry.status,
        updatedAt: entry.updatedAt,
        draftData: initialEntryData(fields, data),
        publishedData: entry.publishedData
          ? initialEntryData(fields, entry.publishedData)
          : entry.publishedData,
      })
    : true
  const busy =
    markReadyMutation.isPending ||
    goLiveNowMutation.isPending ||
    scheduleMutation.isPending ||
    cancelScheduleMutation.isPending ||
    unpublishMutation.isPending ||
    archiveMutation.isPending ||
    deleteMutation.isPending ||
    restoreMutation.isPending ||
    discardMutation.isPending
  const loading =
    Boolean(routeEntryId) &&
    (entryQuery.isLoading || hydratedId !== routeEntryId)
  const ready = Boolean(entry) && hydratedId === entryId && status !== 'saving'

  async function resolveDraftConflict(reapply: boolean) {
    const recovery = recoveredDraft ?? (isDirtyNow() ? dataRef.current : null)
    if (entryIdRef.current) {
      const latest = (await getEntryFn({
        data: { id: entryIdRef.current },
      })) as EntryRecord
      hydrate(latest, true)
      queryClient.setQueryData(queryKeys.entry(latest.id), latest)
    }
    conflictRef.current = false
    setConflict(false)
    setApprovalConflict(false)
    setFormError(null)
    setStatus('idle')
    if (reapply && recovery) {
      setData(recovery)
      setRecoveredDraft(null)
    } else {
      setRecoveredDraft(recovery)
    }
  }

  return {
    sectionChanges,
    dismissSectionChanges: () => setSectionChanges([]),
    applySectionChanges: (updates: SectionLinkUpdate[]) =>
      applySectionChangesMutation.mutateAsync(updates),
    applyingSectionChanges: applySectionChangesMutation.isPending,
    conflict,
    approvalConflict,
    recoveredDraft,
    reloadServerDraft: () => resolveDraftConflict(false),
    reapplyRecoveredDraft: () => resolveDraftConflict(true),
    discardRecoveredDraft: () => {
      setRecoveredDraft(null)
      try {
        localStorage.removeItem(recoveryKey)
      } catch {
        /* best effort */
      }
    },
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
    save: flush,
    markable,
    busy,
    markReady: () => markReadyMutation.mutate({}),
    markReadyPending: markReadyMutation.isPending,
    goLiveNow: async () => {
      const result = await goLiveNowMutation.mutateAsync(markable)
      return result
    },
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
    blocker,
    leaveAnyway: () => {
      bypassRef.current = true
      blocker.proceed?.()
    },
  }
}

export type EntryEditorState = ReturnType<typeof useEntryEditor>
