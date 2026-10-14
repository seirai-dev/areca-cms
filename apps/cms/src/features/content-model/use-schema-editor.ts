import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { globalsQueryKey } from '#/features/globals/use-globals'
import { errorMessage } from '#/lib/admin/helpers'
import { queryKeys } from '#/lib/content/query-keys'
import { isValidPreviewPath } from '#/lib/globals'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  deleteCollectionFn,
  deleteGlobalFn,
  upsertCollectionFn,
  upsertGlobalFn,
} from '#/server/fn/content'

import {
  draftFingerprint,
  draftsFromFields,
  emptyFieldDraft,
  fieldsFromDrafts,
  slugifyKey,
  validateFieldDrafts,
} from './schema-drafts'
import type { FieldDraft, FieldErrors, SchemaKind } from './schema-drafts'

/**
 * The schema being edited. For a site content section (`kind: 'global'`) the
 * route pattern is unused, and `seoEnabled` / `previewPath` apply.
 */
export type CollectionRecord = {
  id?: string
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
  seoEnabled?: boolean
  previewPath?: string | null
}

export type SchemaSegment = 'fields' | 'settings'

/** The field form that replaces the list; `picking` shows the type tiles. */
export type EditingField = { index: number; picking: boolean } | null

function fingerprint(
  next: {
    key: string
    label: string
    routePattern: string
    enabled: boolean
    seo: boolean
    previewPath: string
    fields: FieldDraft[]
  },
  kind: SchemaKind,
) {
  return JSON.stringify([
    next.key,
    next.label,
    next.routePattern,
    next.enabled,
    next.seo,
    next.previewPath,
    draftFingerprint(next.fields, { kind }),
  ])
}

/** The text the Settings inputs hold for a stored preview path. */
function previewPathOf(record: CollectionRecord | null) {
  return record?.previewPath ?? ''
}

/**
 * State and actions of the schema editor sheet (brief §3.10), lifted out of
 * the old collection drawer with its behaviour intact: create mode starts on
 * Settings, the key follows the label until touched, the slug row is locked,
 * saving validates the label and every field row and jumps to the first
 * problem, closing a dirty sheet asks first, and delete is type-to-confirm.
 */
export function useSchemaEditor({
  open,
  onOpenChange,
  siteId,
  collection,
  initialSegment,
  kind = 'collection',
  onCreated,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  /** `null` opens the editor in create mode. */
  collection: CollectionRecord | null
  initialSegment?: SchemaSegment
  kind?: SchemaKind
  onCreated?: (key: string) => void
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()
  const upsertCollection = useServerFn(upsertCollectionFn)
  const deleteCollection = useServerFn(deleteCollectionFn)
  const upsertGlobal = useServerFn(upsertGlobalFn)
  const deleteGlobal = useServerFn(deleteGlobalFn)
  const isGlobal = kind === 'global'
  const creating = collection === null

  const [segment, setSegmentState] = useState<SchemaSegment>('settings')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [label, setLabel] = useState('')
  const [routePattern, setRoutePattern] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [seo, setSeo] = useState(false)
  const [previewPath, setPreviewPath] = useState('')
  const [previewPathError, setPreviewPathError] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldDraft[]>(() =>
    draftsFromFields(undefined, { kind }),
  )
  const [labelError, setLabelError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [editing, setEditing] = useState<EditingField>(null)
  const [baseline, setBaseline] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Reset every time the sheet opens on a (different) collection.
  useEffect(() => {
    if (!open) return
    const nextFields = draftsFromFields(collection?.fields, { kind })
    setSegmentState(initialSegment ?? (collection ? 'fields' : 'settings'))
    setKey(collection?.key ?? '')
    setKeyTouched(Boolean(collection))
    setLabel(collection?.label ?? '')
    setRoutePattern(collection?.routePattern ?? '')
    setEnabled(collection?.enabled ?? true)
    setSeo(Boolean(collection?.seoEnabled))
    setPreviewPath(previewPathOf(collection))
    setPreviewPathError(null)
    setFields(nextFields)
    setLabelError(null)
    setFieldErrors({})
    setEditing(null)
    setDiscardOpen(false)
    setDeleteOpen(false)
    setBaseline(
      fingerprint(
        {
          key: collection?.key ?? '',
          label: collection?.label ?? '',
          routePattern: collection?.routePattern ?? '',
          enabled: collection?.enabled ?? true,
          seo: Boolean(collection?.seoEnabled),
          previewPath: previewPathOf(collection),
          fields: nextFields,
        },
        kind,
      ),
    )
    // Only a new open or another collection resets the form.
  }, [open, collection?.key])

  const current = fingerprint(
    { key, label, routePattern, enabled, seo, previewPath, fields },
    kind,
  )
  const dirty = current !== baseline

  function invalidateSchemas() {
    return queryClient.invalidateQueries({
      queryKey: isGlobal
        ? globalsQueryKey(siteId)
        : queryKeys.collections(siteId),
    })
  }

  const saveMutation = useMutation({
    mutationFn: (draft: {
      key: string
      label: string
      routePattern: string
      enabled: boolean
      seo: boolean
      previewPath: string
      fields: Field[]
    }) =>
      isGlobal
        ? upsertGlobal({
            data: {
              siteId,
              key: draft.key,
              label: draft.label,
              fields: draft.fields,
              seo: draft.seo,
              previewPath: draft.previewPath || null,
              enabled: draft.enabled,
            },
          })
        : upsertCollection({
            data: {
              siteId,
              key: draft.key,
              label: draft.label,
              routePattern: draft.routePattern,
              fields: draft.fields,
              enabled: draft.enabled,
            },
          }),
    onSuccess: async (_result, draft) => {
      toast.success(isGlobal ? m.globals_saved() : m.sites_collection_saved())
      await invalidateSchemas()
      setBaseline(current)
      if (creating) {
        onOpenChange(false)
        onCreated?.(draft.key)
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      isGlobal
        ? deleteGlobal({ data: { siteId, key } })
        : deleteCollection({ data: { siteId, key } }),
    onSuccess: async () => {
      toast.success(
        isGlobal ? m.globals_deleted() : m.sites_collection_deleted(),
      )
      await invalidateSchemas()
      setBaseline(current)
      onOpenChange(false)
      onDeleted?.()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  function save() {
    const trimmedLabel = label.trim()
    const trimmedPreviewPath = previewPath.trim()
    const nextFieldErrors = validateFieldDrafts(fields, { kind })
    const nextPreviewPathError =
      isGlobal && trimmedPreviewPath && !isValidPreviewPath(trimmedPreviewPath)
        ? m.globals_preview_path_invalid()
        : null
    setLabelError(trimmedLabel ? null : m.admin_collection_label_required())
    setPreviewPathError(nextPreviewPathError)
    setFieldErrors(nextFieldErrors)
    const badFields = Object.keys(nextFieldErrors)
      .map(Number)
      .sort((a, b) => a - b)
    if (!trimmedLabel || nextPreviewPathError) {
      setSegmentState('settings')
      setEditing(null)
      return
    }
    if (badFields.length > 0) {
      const firstBadField = badFields[0]
      setSegmentState('fields')
      setEditing((value) =>
        value?.index === firstBadField
          ? value
          : { index: firstBadField, picking: false },
      )
      return
    }
    saveMutation.mutate({
      key: key.trim(),
      label: trimmedLabel,
      routePattern: routePattern.trim(),
      enabled,
      seo,
      previewPath: trimmedPreviewPath,
      fields: fieldsFromDrafts(fields, { kind }),
    })
  }

  function requestClose() {
    if (saveMutation.isPending || deleteMutation.isPending) return
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(false)
  }

  function discard() {
    setDiscardOpen(false)
    setBaseline(current)
    onOpenChange(false)
  }

  function setSegment(next: SchemaSegment) {
    setSegmentState(next)
    setEditing(null)
  }

  function patchMeta(patch: {
    key?: string
    label?: string
    routePattern?: string
    previewPath?: string
  }) {
    if (patch.previewPath !== undefined) {
      setPreviewPath(patch.previewPath)
      setPreviewPathError(null)
    }
    if (patch.key !== undefined) {
      setKey(patch.key)
      setKeyTouched(true)
    }
    if (patch.label !== undefined) {
      setLabel(patch.label)
      setLabelError(null)
      if (creating && !keyTouched && patch.key === undefined)
        setKey(slugifyKey(patch.label))
    }
    if (patch.routePattern !== undefined) setRoutePattern(patch.routePattern)
  }

  function patchField(index: number, patch: Partial<FieldDraft>) {
    setFields((list) =>
      list.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )
    setFieldErrors({})
    if (editing?.index === index && editing.picking && patch.type) {
      setEditing({ index, picking: false })
    }
  }

  function replaceFields(next: FieldDraft[]) {
    setFields(next)
    setFieldErrors({})
  }

  function removeField(index: number) {
    // The collection's slug row (always first) cannot be removed.
    if (!isGlobal && index === 0) return
    setFields((list) => list.filter((_, i) => i !== index))
    setFieldErrors({})
    setEditing(null)
  }

  function addField() {
    setSegmentState('fields')
    setFields((list) => [...list, emptyFieldDraft()])
    setEditing({ index: fields.length, picking: true })
  }

  /** Back to the list; a field abandoned at the type step is dropped. */
  function closeField() {
    if (editing?.picking) {
      const index = editing.index
      setFields((list) => list.filter((_, i) => i !== index))
    }
    setEditing(null)
  }

  return {
    kind,
    creating,
    segment,
    setSegment,
    key,
    label,
    routePattern,
    enabled,
    setEnabled,
    seo,
    setSeo,
    previewPath,
    previewPathError,
    fields,
    labelError,
    fieldErrors,
    editing,
    setEditing,
    editingField: editing ? fields[editing.index] : undefined,
    dirty,
    saving: saveMutation.isPending,
    deleting: deleteMutation.isPending,
    save,
    requestClose,
    discard,
    discardOpen,
    setDiscardOpen,
    deleteOpen,
    setDeleteOpen,
    deleteCollection: () => deleteMutation.mutateAsync(),
    patchMeta,
    patchField,
    replaceFields,
    removeField,
    addField,
    closeField,
  }
}

export type SchemaEditor = ReturnType<typeof useSchemaEditor>
