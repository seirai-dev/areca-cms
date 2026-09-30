import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Lock,
  Plus,
  SlidersHorizontal,
  Stack,
  Trash,
} from '@phosphor-icons/react'

import { queryKeys } from '#/lib/content/query-keys'
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
import { FormField } from '#/components/ui/form-field'
import { InsetIcon } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { SlideOver } from '#/components/ui/slide-over'
import { CheckDraw } from '#/components/ui/status-pill'
import { Switch } from '#/components/ui/switch'
import { EASE_STANDARD } from '#/lib/motion'
import { collectionIcon } from '#/lib/site-nav'
import { m } from '#/paraglide/messages'
import { listCollectionsFn } from '#/server/fn/content'

import { FieldFormPanel, FieldList } from './schema-fields'
import { useSchemaEditor } from './use-schema-editor'
import type { CollectionRecord, SchemaSegment } from './use-schema-editor'

export type { CollectionRecord, SchemaSegment }

/**
 * The schema editor (brief §3.10): a large slide-over that owns one content
 * type end to end. **Fields** lists the fields (locked slug row, drag to
 * reorder, click to edit, type tiles for new ones); **Settings** holds the
 * name, key, route, the on/off switch and the danger zone. Opened from
 * Settings › Content, and from a collection's ⋯ › Edit structure.
 */
export function SchemaEditorSheet({
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
  const editor = useSchemaEditor({
    open,
    onOpenChange,
    siteId,
    collection,
    initialSegment,
    onCreated,
    onDeleted,
  })
  const reduce = useReducedMotion()
  const collectionsQuery = useQuery({
    queryKey: queryKeys.collections(siteId),
    queryFn: () => listCollectionsFn({ data: { siteId } }),
    enabled: open,
  })
  const collectionKeys = (collectionsQuery.data ?? []).map((item) => ({
    key: item.key,
    label: item.label,
  }))

  const Icon = collection
    ? collectionIcon(collection.key, collection.label)
    : editor.label
      ? collectionIcon(editor.key, editor.label)
      : Stack

  const fieldCount = editor.fields.length
  const panelMotion = reduce
    ? {}
    : {
        initial: { opacity: 0, x: 12 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -12 },
        transition: { duration: 0.18, ease: EASE_STANDARD },
      }

  return (
    <>
      <SlideOver
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true)
          else editor.requestClose()
        }}
        size="lg"
        data-testid="collection-drawer"
        headerStart={
          <InsetIcon tone="accent" className="mt-0.5 size-9 rounded-[10px]">
            <Icon weight="fill" />
          </InsetIcon>
        }
        title={
          editor.creating
            ? editor.label.trim() || m.settings_new_content_type()
            : collection?.label
        }
        description={
          editor.creating ? (
            m.content_schema_create_description()
          ) : (
            <span className="text-mono">
              {collection?.key} · {collection?.routePattern}
            </span>
          )
        }
        bodyClassName="px-0 pb-8"
        footer={
          <div className="flex items-center justify-between gap-3">
            <p
              className="flex min-w-0 items-center gap-1.5 truncate text-callout text-text-secondary"
              aria-live="polite"
            >
              {editor.dirty ? (
                <>
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-status-warning"
                  />
                  {m.content_schema_unsaved()}
                </>
              ) : editor.creating ? (
                m.content_schema_not_created()
              ) : (
                <>
                  <CheckDraw size={14} className="text-icon-success" />
                  {m.editor_all_changes_saved()}
                </>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="quiet"
                onClick={editor.requestClose}
                disabled={editor.saving}
              >
                {m.shared_cancel()}
              </Button>
              <Button
                type="button"
                data-testid="save-collection"
                loading={editor.saving}
                onClick={editor.save}
              >
                {editor.saving
                  ? m.admin_saving()
                  : editor.creating
                    ? m.content_schema_create()
                    : m.admin_collection_save()}
              </Button>
            </div>
          </div>
        }
      >
        <div className="sticky top-0 z-10 bg-background-elevated/90 px-5 pt-1 pb-4 backdrop-blur-md">
          <SegmentedControl
            semantics="tabs"
            fullWidth
            aria-label={m.content_schema_sections()}
            value={editor.segment}
            onValueChange={(value) => editor.setSegment(value)}
            options={[
              {
                value: 'fields',
                label: m.admin_collection_fields(),
                testId: 'schema-tab-fields',
              },
              {
                value: 'settings',
                label: m.shell_nav_settings(),
                testId: 'schema-tab-settings',
              },
            ]}
          />
        </div>

        <div className="px-5">
          {editor.segment === 'fields' ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <div className="grid gap-0.5">
                  <p className="text-headline text-text-primary tnum">
                    {fieldCount === 1
                      ? m.admin_collection_field_count_one({
                          count: fieldCount,
                        })
                      : m.admin_collection_field_count_other({
                          count: fieldCount,
                        })}
                  </p>
                  <p className="text-callout text-text-secondary">
                    {m.content_schema_fields_hint()}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid="add-field"
                  onClick={editor.addField}
                >
                  <Plus weight="bold" />
                  {m.admin_collection_add_field()}
                </Button>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {editor.editing && editor.editingField ? (
                  <motion.div
                    key={`form-${editor.editing.index}-${editor.editing.picking}`}
                    {...panelMotion}
                  >
                    <FieldFormPanel
                      field={editor.editingField}
                      index={editor.editing.index}
                      errors={editor.fieldErrors[editor.editing.index]}
                      pickingType={editor.editing.picking}
                      collectionKeys={collectionKeys}
                      onChange={(patch) =>
                        editor.editing &&
                        editor.patchField(editor.editing.index, patch)
                      }
                      onBack={editor.closeField}
                      onRemove={() =>
                        editor.editing &&
                        editor.removeField(editor.editing.index)
                      }
                    />
                  </motion.div>
                ) : (
                  <motion.div key="list" {...panelMotion}>
                    <FieldList
                      fields={editor.fields}
                      errors={editor.fieldErrors}
                      onChange={editor.replaceFields}
                      onOpen={(index) =>
                        editor.setEditing({ index, picking: false })
                      }
                      onRemove={editor.removeField}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="grid gap-6">
              <section className="grid gap-2">
                <h3 className="px-1 text-overline text-text-muted">
                  {m.content_schema_identity()}
                </h3>
                <div className="grid gap-4 surface-card p-4">
                  <FormField
                    label={m.content_schema_name()}
                    htmlFor="collection-label"
                    error={editor.labelError ?? undefined}
                    hint={m.content_schema_name_hint()}
                    required
                  >
                    <Input
                      id="collection-label"
                      data-testid="collection-label"
                      value={editor.label}
                      placeholder={m.content_schema_name_placeholder()}
                      autoFocus={editor.creating}
                      aria-invalid={editor.labelError ? true : undefined}
                      onChange={(event) =>
                        editor.patchMeta({ label: event.target.value })
                      }
                    />
                  </FormField>
                  <FormField
                    label={m.admin_collection_key()}
                    htmlFor="collection-key"
                    hint={
                      editor.creating
                        ? m.content_schema_key_hint()
                        : m.admin_collection_key_locked_hint()
                    }
                    trailing={
                      editor.creating ? null : (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="size-3" />
                          {m.content_schema_locked()}
                        </span>
                      )
                    }
                  >
                    <Input
                      id="collection-key"
                      data-testid="collection-key"
                      readOnly={!editor.creating}
                      className="font-mono text-[13px]"
                      spellCheck={false}
                      autoCapitalize="off"
                      value={editor.key}
                      onChange={(event) =>
                        editor.patchMeta({ key: event.target.value })
                      }
                    />
                  </FormField>
                  <FormField
                    label={m.admin_collection_route()}
                    htmlFor="collection-route"
                    hint={m.content_schema_route_hint()}
                  >
                    <Input
                      id="collection-route"
                      data-testid="collection-route"
                      className="font-mono text-[13px]"
                      spellCheck={false}
                      autoCapitalize="off"
                      placeholder="/pages/$slug"
                      value={editor.routePattern}
                      onChange={(event) =>
                        editor.patchMeta({ routePattern: event.target.value })
                      }
                    />
                  </FormField>
                </div>
              </section>

              <section className="grid gap-2">
                <h3 className="px-1 text-overline text-text-muted">
                  {m.content_schema_availability()}
                </h3>
                <label className="flex cursor-pointer items-center justify-between gap-4 surface-card px-4 py-3.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <InsetIcon tone={editor.enabled ? 'success' : 'neutral'}>
                      <SlidersHorizontal />
                    </InsetIcon>
                    <span className="grid gap-0.5">
                      <span className="text-[14px] leading-5 font-medium text-text-primary">
                        {editor.enabled
                          ? m.content_schema_on()
                          : m.content_schema_off()}
                      </span>
                      <span className="text-callout text-text-secondary">
                        {m.content_schema_enabled_hint()}
                      </span>
                    </span>
                  </span>
                  <Switch
                    checked={editor.enabled}
                    onCheckedChange={editor.setEnabled}
                    aria-label={m.admin_collection_enabled()}
                    data-testid="collection-enabled"
                  />
                </label>
              </section>

              {!editor.creating && collection ? (
                <section className="grid gap-2">
                  <h3 className="px-1 text-overline text-text-error">
                    {m.sites_danger_zone()}
                  </h3>
                  <div className="flex flex-col gap-3 rounded-card border border-border-error/40 bg-background-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-callout text-text-secondary">
                      {m.sites_delete_collection_description({
                        label: collection.label,
                      })}
                    </p>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      data-testid="delete-collection"
                      onClick={() => editor.setDeleteOpen(true)}
                    >
                      <Trash />
                      {m.content_schema_delete()}
                    </Button>
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </SlideOver>

      <AlertDialog
        open={editor.discardOpen}
        onOpenChange={editor.setDiscardOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.admin_collection_discard_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.content_schema_discard_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {m.admin_collection_keep_editing()}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="discard-collection-changes"
              onClick={editor.discard}
            >
              {m.admin_collection_discard_changes()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={editor.deleteOpen}
        onOpenChange={editor.setDeleteOpen}
        title={m.sites_delete_collection_title()}
        description={m.sites_delete_collection_description({
          label: collection?.label ?? editor.key,
        })}
        confirmLabel={m.content_schema_delete()}
        confirmText={editor.key}
        variant="destructive"
        onConfirm={async () => {
          await editor.deleteCollection()
        }}
      />
    </>
  )
}
