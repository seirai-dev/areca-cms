import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'

import {
  CollectionMetaFields,
  EnabledSwitch,
  FieldFormPanel,
  FieldList,
  draftFingerprint,
  draftsFromFields,
  emptyFieldDraft,
  fieldsFromDrafts,
  validateFieldDrafts,
} from '#/components/admin/collection-form'
import type {
  FieldDraft,
  FieldErrors,
} from '#/components/admin/collection-form'
import { errorMessage } from '#/components/admin/helpers'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { queryKeys } from '#/components/editor/query-keys'
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
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { Spinner } from '#/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  deleteCollectionFn,
  upsertCollectionFn,
} from '#/server/fn/content'
import { Plus, Trash } from '@phosphor-icons/react'

export type CollectionRecord = {
  id?: string
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

type Segment = 'fields' | 'settings'

type Editing = { index: number; picking: boolean } | null

/**
 * Right drawer that owns a collection end to end: its schema (Fields) and its
 * identity, route and lifecycle (Settings). Opened from the collections rail
 * for an existing collection, or from "Add collection" in create mode, where
 * Settings comes first because the key and route must exist before fields
 * mean anything.
 */
export function CollectionDrawer({
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
  /** `null` opens the drawer in create mode. */
  collection: CollectionRecord | null
  initialSegment?: Segment
  onCreated?: (key: string) => void
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()
  const upsertCollection = useServerFn(upsertCollectionFn)
  const deleteCollection = useServerFn(deleteCollectionFn)
  const reduceMotion = useReducedMotion()
  const creating = collection === null

  const [segment, setSegment] = useState<Segment>('settings')
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [routePattern, setRoutePattern] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [fields, setFields] = useState<FieldDraft[]>(() =>
    draftsFromFields(undefined),
  )
  const [labelError, setLabelError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [editing, setEditing] = useState<Editing>(null)
  const [baseline, setBaseline] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

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

  // Reset every time the drawer opens on a (different) collection.
  useEffect(() => {
    if (!open) return
    const nextFields = draftsFromFields(collection?.fields)
    setSegment(initialSegment ?? (collection ? 'fields' : 'settings'))
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
      setSegment('settings')
      setEditing(null)
      return
    }
    if (badFields.length > 0) {
      const firstBadField = badFields[0]
      setSegment('fields')
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

  function patchField(index: number, patch: Partial<FieldDraft>) {
    setFields((list) =>
      list.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )
    setFieldErrors({})
  }

  function addField() {
    setSegment('fields')
    setFields((list) => [...list, emptyFieldDraft()])
    setEditing({ index: fields.length, picking: true })
  }

  const editingField = editing ? fields[editing.index] : undefined

  const panelMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, x: 16 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: 16 },
        transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const },
      }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else requestClose()
      }}
    >
      <SheetContent
        side="right"
        size="lg"
        anchor="viewport"
        className="p-0"
        data-testid="collection-drawer"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          requestClose()
        }}
      >
        <SheetHeader className="gap-3">
          <div className="grid gap-1 pr-8">
            <SheetTitle>
              {creating
                ? m.admin_collection_add_title()
                : collection.label}
            </SheetTitle>
            <SheetDescription>
              {creating
                ? m.admin_collection_description()
                : m.content_drawer_description()}
            </SheetDescription>
          </div>
          <Tabs
            value={segment}
            onValueChange={(value) => {
              setSegment(value as Segment)
              setEditing(null)
            }}
          >
            <TabsList variant="segmented" className="w-full">
              <TabsTrigger value="fields">
                {m.admin_collection_fields()}
              </TabsTrigger>
              <TabsTrigger value="settings">
                {m.shell_nav_settings()}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </SheetHeader>

        <SheetBody>
          {segment === 'fields' ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-ds-body-sm text-text-muted">
                  {fields.length === 1
                    ? m.admin_collection_field_count_one({
                        count: fields.length,
                      })
                    : m.admin_collection_field_count_other({
                        count: fields.length,
                      })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid="add-field"
                  onClick={addField}
                >
                  <Plus />
                  {m.admin_collection_add_field()}
                </Button>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {editing && editingField ? (
                  <motion.div key={`form-${editing.index}`} {...panelMotion}>
                    <FieldFormPanel
                      field={editingField}
                      index={editing.index}
                      errors={fieldErrors[editing.index]}
                      pickingType={editing.picking}
                      onChange={(patch) => {
                        patchField(editing.index, patch)
                        if (editing.picking && patch.type) {
                          setEditing({ index: editing.index, picking: false })
                        }
                      }}
                      onBack={() => {
                        if (editing.picking) {
                          setFields((list) =>
                            list.filter((_, i) => i !== editing.index),
                          )
                        }
                        setEditing(null)
                      }}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="list" {...panelMotion}>
                    <FieldList
                      fields={fields}
                      errors={fieldErrors}
                      onChange={(next) => {
                        setFields(next)
                        setFieldErrors({})
                      }}
                      onOpen={(index) => setEditing({ index, picking: false })}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="grid gap-6">
              <CollectionMetaFields
                keyValue={key}
                label={label}
                routePattern={routePattern}
                labelError={labelError}
                keyLocked={!creating}
                onChange={(patch) => {
                  if (patch.key !== undefined) setKey(patch.key)
                  if (patch.label !== undefined) {
                    setLabel(patch.label)
                    setLabelError(null)
                    if (creating && !key.trim())
                      setKey(slugifyKey(patch.label))
                  }
                  if (patch.routePattern !== undefined)
                    setRoutePattern(patch.routePattern)
                }}
              />
              <div className="border-t border-border-subtle pt-6">
                <EnabledSwitch checked={enabled} onCheckedChange={setEnabled} />
              </div>
              {!creating ? (
                <div className="border-t border-border-error pt-6">
                  <h3 className="text-ds-heading-5 text-text-error">
                    {m.sites_danger_zone()}
                  </h3>
                  <p className="mt-1 mb-3 text-ds-body-sm text-text-secondary">
                    {m.sites_delete_collection_description({
                      label: collection.label,
                    })}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    data-testid="delete-collection"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash />
                    {m.sites_delete_collection()}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </SheetBody>

        <SheetFooter className="flex-row items-center justify-between">
          <p className="text-ds-body-sm text-text-secondary">
            {dirty ? m.shared_unsaved_changes() : m.editor_all_changes_saved()}
          </p>
          <Button
            type="button"
            data-testid="save-collection"
            disabled={saveMutation.isPending}
            onClick={save}
          >
            {saveMutation.isPending ? <Spinner /> : null}
            {saveMutation.isPending
              ? m.admin_saving()
              : m.admin_collection_save()}
          </Button>
        </SheetFooter>
      </SheetContent>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.admin_collection_discard_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.admin_collection_discard_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {m.admin_collection_keep_editing()}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="discard-collection-changes"
              onClick={() => {
                setDiscardOpen(false)
                setBaseline(current)
                onOpenChange(false)
              }}
            >
              {m.admin_collection_discard_changes()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={m.sites_delete_collection_title()}
        description={m.sites_delete_collection_description({
          label: collection?.label ?? key,
        })}
        confirmLabel={m.sites_delete_collection()}
        confirmText={key}
        variant="destructive"
        onConfirm={async () => {
          await deleteMutation.mutateAsync()
        }}
      />
    </Sheet>
  )
}

/** `Blog posts` becomes `blog-posts`, matching the manifest convention. */
function slugifyKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
