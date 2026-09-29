import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'

import { errorMessage } from '#/components/admin/helpers'
import { queryKeys } from '#/components/editor/query-keys'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import { deleteCollectionFn, upsertCollectionFn } from '#/server/fn/content'

import {
  draftFingerprint,
  draftsFromFields,
  emptyFieldDraft,
  fieldsFromDrafts,
  slugifyKey,
  validateFieldDrafts,
} from './schema-drafts'
import type { FieldDraft, FieldErrors } from './schema-drafts'

export type CollectionRecord = {
  id?: string
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

export type SchemaSegment = 'fields' | 'settings'

/** The field form that replaces the list; `picking` shows the type tiles. */
export type EditingField = { index: number; picking: boolean } | null

function fingerprint(next: {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: FieldDraft[]
}) {
  return JSON.stringify([
    next.key,
    next.label,
    next.routePattern,
    next.enabled,
    draftFingerprint(next.fields),
  ])
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
  onCreated,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
  /** `null` opens the editor in create mode. */
  collection: CollectionRecord | null
  initialSegment?: SchemaSegment
  onCreated?: (key: string) => void
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()
  const upsertCollection = useServerFn(upsertCollectionFn)
  const deleteCollection = useServerFn(deleteCollectionFn)
  const creating = collection === null

  const [segment, setSegmentState] = useState<SchemaSegment>('settings')
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [routePattern, setRoutePattern] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [fields, setFields] = useState<FieldDraft[]>(() =>
    draftsFromFields(undefined),
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
    const nextFields = draftsFromFields(collection?.fields)
    setSegmentState(initialSegment ?? (collection ? 'fields' : 'settings'))
    setKey(collection?.key ?? '')
    setLabel(collection?.label ?? '')
    setRoutePattern(collection?.routePattern ?? '')
    setEnabled(collection?.enabled ?? true)
    setFields(nextFields)
    setLabelError(null)
    setFieldErrors({})
    setEditing(null)
    setDiscardOpen(false)
    setDeleteOpen(false)
    setBaseline(
      fingerprint({
        key: collection?.key ?? '',
        label: collection?.label ?? '',
        routePattern: collection?.routePattern ?? '',
        enabled: collection?.enabled ?? true,
        fields: nextFields,
      }),
    )
    // Only a new open or another collection resets the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collection?.key])

  const current = fingerprint({ key, label, routePattern, enabled, fields })
  const dirty = current !== baseline

  const saveMutation = useMutation({
    mutationFn: (draft: {
      key: string
      label: string
      routePattern: string
      enabled: boolean
      fields: Field[]
    }) => upsertCollection({ data: { siteId, ...draft } }),
    onSuccess: async (_result, draft) => {
      toast.success(m.sites_collection_saved())
      await queryClient.invalidateQueries({
        queryKey: queryKeys.collections(siteId),
      })
      setBaseline(current)
      if (creating) {
        onOpenChange(false)
        onCreated?.(draft.key)
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteCollection({ data: { siteId, key } }),
    onSuccess: async () => {
      toast.success(m.sites_collection_deleted())
      await queryClient.invalidateQueries({
        queryKey: queryKeys.collections(siteId),
      })
      setBaseline(current)
      onOpenChange(false)
      onDeleted?.()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  function save() {
    const trimmedLabel = label.trim()
    const nextFieldErrors = validateFieldDrafts(fields)
    setLabelError(trimmedLabel ? null : m.admin_collection_label_required())
    setFieldErrors(nextFieldErrors)
    const badFields = Object.keys(nextFieldErrors)
      .map(Number)
      .sort((a, b) => a - b)
    if (!trimmedLabel) {
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
      fields: fieldsFromDrafts(fields),
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
  }) {
    if (patch.key !== undefined) setKey(patch.key)
    if (patch.label !== undefined) {
      setLabel(patch.label)
      setLabelError(null)
      if (creating && !key.trim()) setKey(slugifyKey(patch.label))
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
    if (index === 0) return
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
    creating,
    segment,
    setSegment,
    key,
    label,
    routePattern,
    enabled,
    setEnabled,
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
