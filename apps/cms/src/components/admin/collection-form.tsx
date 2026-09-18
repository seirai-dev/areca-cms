import { useState } from 'react'
import { Reorder, useDragControls } from 'motion/react'

import { EntityIcon } from '#/components/entity-icon'
import { FormField } from '#/components/form-field'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import type { Field, FieldType } from '#/lib/types'
import {
  REQUIRED_SLUG_FIELD,
  withRequiredSlugField,
} from '#/lib/collection-fields'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import { FIELD_TYPES, fieldTypeLabel } from './helpers'
import {
  ArrowLeft,
  Calendar,
  CalendarDots,
  DotsSixVertical,
  TextAa,
  Hash,
  Image,
  Link,
  ListChecks,
  Lock,
  Paragraph,
  TextAlignLeft,
  TextT,
  ToggleLeft,
  Trash,
} from '@phosphor-icons/react'
import type { Icon as IconComponent } from '@phosphor-icons/react'

export type FieldDraft = {
  /** Stable identity for reordering; never sent to the server. */
  id: string
  key: string
  label: string
  type: FieldType
  required: boolean
  options: string
  collection: string
  description: string
  /** False until the user edits the key by hand, so it follows the label. */
  keyTouched: boolean
}

export type CollectionDraft = {
  key: string
  label: string
  routePattern: string
  enabled: boolean
  fields: Field[]
}

export type FieldErrors = Partial<
  Record<number, { key?: string; label?: string }>
>

export const FIELD_TYPE_ICONS: Record<FieldType, IconComponent> = {
  text: TextT,
  textarea: TextAlignLeft,
  richtext: Paragraph,
  image: Image,
  date: Calendar,
  datetime: CalendarDots,
  select: ListChecks,
  reference: Link,
  slug: TextAa,
  boolean: ToggleLeft,
  number: Hash,
  url: Link,
}

export function fieldTypeDescription(type: FieldType) {
  switch (type) {
    case 'text':
      return m.admin_field_desc_text()
    case 'textarea':
      return m.admin_field_desc_textarea()
    case 'richtext':
      return m.admin_field_desc_richtext()
    case 'image':
      return m.admin_field_desc_image()
    case 'date':
      return m.admin_field_desc_date()
    case 'datetime':
      return m.admin_field_desc_datetime()
    case 'select':
      return m.admin_field_desc_select()
    case 'reference':
      return m.admin_field_desc_reference()
    case 'slug':
      return m.admin_field_desc_slug()
    case 'boolean':
      return m.admin_field_desc_boolean()
    case 'number':
      return m.admin_field_desc_number()
    case 'url':
      return m.admin_field_desc_url()
  }
}

let draftSeq = 0
function nextDraftId() {
  draftSeq += 1
  return `fd-${draftSeq}`
}

/** `Hero image` becomes `heroImage`, the convention used by the SDK. */
export function keyFromLabel(label: string) {
  const words = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (words.length === 0) return ''
  return words
    .map((word, index) =>
      index === 0 ? word : word[0].toUpperCase() + word.slice(1),
    )
    .join('')
}

export function emptyFieldDraft(type: FieldType = 'text'): FieldDraft {
  return {
    id: nextDraftId(),
    key: '',
    label: '',
    type,
    required: false,
    options: '',
    collection: '',
    description: '',
    keyTouched: false,
  }
}

export function toFieldDraft(field: Field): FieldDraft {
  return {
    id: nextDraftId(),
    key: field.key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    options: field.options?.join(', ') ?? '',
    collection: field.collection ?? '',
    description: field.description ?? '',
    keyTouched: true,
  }
}

export function draftsFromFields(fields: Field[] | undefined) {
  return withRequiredSlugField(fields ?? [REQUIRED_SLUG_FIELD]).map(
    toFieldDraft,
  )
}

export function fieldsFromDrafts(drafts: FieldDraft[]): Field[] {
  return drafts.map((field) => ({
    key: field.key.trim(),
    label: field.label.trim(),
    type: field.type,
    required: field.required || undefined,
    description: field.description.trim() || undefined,
    options:
      field.type === 'select'
        ? field.options
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean)
        : undefined,
    collection:
      field.type === 'reference'
        ? field.collection.trim() || undefined
        : undefined,
  }))
}

/** Comparable shape for the dirty check: ids and UI-only flags dropped. */
export function draftFingerprint(drafts: FieldDraft[]) {
  return JSON.stringify(fieldsFromDrafts(drafts))
}

/** Returns per-row errors for empty keys or labels. */
export function validateFieldDrafts(drafts: FieldDraft[]): FieldErrors {
  const errors: FieldErrors = {}
  drafts.forEach((field, index) => {
    if (!field.key.trim()) {
      errors[index] = {
        ...errors[index],
        key: m.admin_collection_field_key_required(),
      }
    }
    if (!field.label.trim()) {
      errors[index] = {
        ...errors[index],
        label: m.admin_collection_field_label_required(),
      }
    }
  })
  return errors
}

/**
 * Two-column grid of field types. Used both as the first step of "Add field"
 * and as the type control of an open field form.
 */
export function FieldTypeTiles({
  value,
  onPick,
  testId,
}: {
  value?: FieldType
  onPick: (type: FieldType) => void
  testId?: string
}) {
  const types = FIELD_TYPES.filter((type) => type !== 'slug')
  return (
    <div
      className="grid gap-2 sm:grid-cols-2"
      role="radiogroup"
      aria-label={m.admin_collection_field_type()}
      data-testid={testId}
    >
      {types.map((type) => {
        const active = value === type
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`field-type-tile-${type}`}
            onClick={() => onPick(type)}
            className={cn(
              'flex items-start gap-3 rounded-surface border p-3 text-left',
              'transition-colors duration-[120ms] ease-(--motion-ease-standard)',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
              active
                ? 'border-border-success bg-status-success-bg/40'
                : 'border-border-default hover:bg-surface-state-hover',
            )}
          >
            <EntityIcon
              icon={FIELD_TYPE_ICONS[type]}
              size="sm"
              tone={active ? 'brand' : 'muted'}
            />
            <span className="min-w-0">
              <span className="block text-ds-label-md text-text-primary">
                {fieldTypeLabel(type)}
              </span>
              <span className="block text-ds-body-xs text-text-muted">
                {fieldTypeDescription(type)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Label, key and route inputs of the Settings segment. */
export function CollectionMetaFields({
  keyValue,
  label,
  routePattern,
  labelError,
  keyLocked,
  onChange,
}: {
  keyValue: string
  label: string
  routePattern: string
  labelError: string | null
  keyLocked?: boolean
  onChange: (patch: {
    key?: string
    label?: string
    routePattern?: string
  }) => void
}) {
  return (
    <div className="grid gap-4">
      <FormField
        label={m.admin_collection_label()}
        htmlFor="collection-label"
        error={labelError ?? undefined}
        required
      >
        <Input
          id="collection-label"
          data-testid="collection-label"
          value={label}
          aria-invalid={labelError ? true : undefined}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </FormField>
      <FormField
        label={m.admin_collection_key()}
        htmlFor="collection-key"
        hint={keyLocked ? m.admin_collection_key_locked_hint() : undefined}
      >
        <Input
          id="collection-key"
          data-testid="collection-key"
          readOnly={keyLocked}
          className="font-mono"
          value={keyValue}
          onChange={(event) => onChange({ key: event.target.value })}
        />
      </FormField>
      <FormField
        label={m.admin_collection_route()}
        htmlFor="collection-route"
        hint={m.admin_collection_route_hint()}
      >
        <Input
          id="collection-route"
          data-testid="collection-route"
          className="font-mono"
          placeholder="/pages/$slug"
          value={routePattern}
          onChange={(event) => onChange({ routePattern: event.target.value })}
        />
      </FormField>
    </div>
  )
}

export function EnabledSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="grid gap-0.5">
        <span className="text-ds-label-md text-text-primary">
          {m.admin_collection_enabled()}
        </span>
        <span className="text-ds-body-xs text-text-muted">
          {m.admin_collection_enabled_hint()}
        </span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

/** One compact row of the field list: handle, icon, label, key, chips. */
function FieldListRow({
  field,
  index,
  invalid,
  onOpen,
  onRemove,
}: {
  field: FieldDraft
  index: number
  invalid: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const controls = useDragControls()
  const Icon = FIELD_TYPE_ICONS[field.type]

  return (
    <Reorder.Item
      value={field}
      dragListener={false}
      dragControls={controls}
      data-testid={`field-row-${index}`}
      className={cn(
        'group flex items-center gap-2 rounded-control border px-2 py-2',
        invalid ? 'border-border-error' : 'border-transparent',
        'hover:bg-surface-state-hover',
      )}
    >
      <button
        type="button"
        aria-label={m.content_reorder_field({ label: field.label })}
        onPointerDown={(event) => controls.start(event)}
        className="cursor-grab touch-none rounded-control p-1 text-icon-muted hover:text-text-primary active:cursor-grabbing"
      >
        <DotsSixVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
      >
        <EntityIcon icon={Icon} size="sm" tone="muted" />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-ds-label-md text-text-primary"
            data-testid={`field-label-${index}`}
          >
            {field.label || m.content_field_untitled()}
          </span>
          <span
            className="block truncate text-ds-mono-xs text-text-muted"
            data-testid={`field-key-${index}`}
          >
            {field.key}
          </span>
        </span>
        <span
          className="shrink-0 text-ds-mono-xs text-text-muted"
          data-testid={`field-type-${index}`}
        >
          {fieldTypeLabel(field.type)}
        </span>
        {field.required ? (
          <Badge variant="muted" className="shrink-0 text-ds-mono-caps">
            {m.admin_collection_required()}
          </Badge>
        ) : null}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-icon-muted hover:text-text-error"
        aria-label={m.admin_collection_remove_field()}
        title={m.admin_collection_remove_field()}
        onClick={onRemove}
      >
        <Trash />
      </Button>
    </Reorder.Item>
  )
}

/** Locked slug row: always first, never dragged or removed. */
function SlugRow({ field }: { field: FieldDraft }) {
  return (
    <li
      data-testid="field-row-0"
      data-locked="true"
      className="flex items-center gap-2 rounded-control border border-transparent bg-background-subtle px-2 py-2"
    >
      <span className="p-1 text-icon-muted">
        <Lock className="size-4" />
      </span>
      <EntityIcon icon={FIELD_TYPE_ICONS.slug} size="sm" tone="muted" />
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-ds-label-md text-text-primary"
          data-testid="field-label-0"
        >
          {field.label}
        </span>
        <span
          className="block truncate text-ds-mono-xs text-text-muted"
          data-testid="field-key-0"
        >
          {field.key}
        </span>
      </span>
      <span
        className="shrink-0 text-ds-mono-xs text-text-muted"
        data-testid="field-type-0"
      >
        {fieldTypeLabel(field.type)}
      </span>
      <Badge variant="muted" className="shrink-0 text-ds-mono-caps">
        {m.admin_collection_required()}
      </Badge>
    </li>
  )
}

/**
 * Compact, reorderable field list. Row 0 is the locked slug field; every
 * other row opens the field form when clicked.
 */
export function FieldList({
  fields,
  errors,
  onChange,
  onOpen,
}: {
  fields: FieldDraft[]
  errors: FieldErrors
  onChange: (next: FieldDraft[]) => void
  onOpen: (index: number) => void
}) {
  const [slug, ...rest] = fields

  return (
    <div className="grid gap-1">
      <ol className="grid gap-1">
        <SlugRow field={slug} />
      </ol>
      <Reorder.Group
        axis="y"
        as="ol"
        values={rest}
        onReorder={(next: FieldDraft[]) => onChange([slug, ...next])}
        className="grid gap-1"
      >
        {rest.map((field, offset) => {
          const index = offset + 1
          return (
            <FieldListRow
              key={field.id}
              field={field}
              index={index}
              invalid={Boolean(errors[index])}
              onOpen={() => onOpen(index)}
              onRemove={() =>
                onChange(fields.filter((_, i) => i !== index))
              }
            />
          )
        })}
      </Reorder.Group>
    </div>
  )
}

/**
 * The nested panel that edits one field. Rendered instead of the list so the
 * `field-*-N` ids stay unique; `pickingType` shows the tile grid first.
 */
export function FieldFormPanel({
  field,
  index,
  errors,
  pickingType,
  onChange,
  onBack,
}: {
  field: FieldDraft
  index: number
  errors: FieldErrors[number]
  pickingType: boolean
  onChange: (patch: Partial<FieldDraft>) => void
  onBack: () => void
}) {
  if (pickingType) {
    return (
      <div className="grid gap-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onBack}>
            <ArrowLeft />
            <span className="sr-only">{m.content_back_to_fields()}</span>
          </Button>
          <p className="text-ds-heading-5 text-text-primary">
            {m.admin_collection_add_field()}
          </p>
        </div>
        <p className="text-ds-body-sm text-text-secondary">
          {m.admin_field_picker_description()}
        </p>
        <FieldTypeTiles
          onPick={(type) => onChange({ type })}
          testId={`field-type-${index}`}
        />
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft />
          <span className="sr-only">{m.content_back_to_fields()}</span>
        </Button>
        <p className="min-w-0 truncate text-ds-heading-5 text-text-primary">
          {field.label || m.content_field_untitled()}
        </p>
      </div>
      <FormField
        label={m.admin_collection_label()}
        htmlFor={`field-label-${index}`}
        error={errors?.label}
        required
      >
        <Input
          id={`field-label-${index}`}
          data-testid={`field-label-${index}`}
          value={field.label}
          aria-invalid={errors?.label ? true : undefined}
          onChange={(event) => {
            const label = event.target.value
            onChange(
              field.keyTouched
                ? { label }
                : { label, key: keyFromLabel(label) },
            )
          }}
        />
      </FormField>
      <FormField
        label={m.admin_collection_key()}
        htmlFor={`field-key-${index}`}
        error={errors?.key}
        required
      >
        <Input
          id={`field-key-${index}`}
          data-testid={`field-key-${index}`}
          className="font-mono"
          value={field.key}
          aria-invalid={errors?.key ? true : undefined}
          onChange={(event) =>
            onChange({ key: event.target.value, keyTouched: true })
          }
        />
      </FormField>
      <FormField label={m.admin_collection_field_type()}>
        <FieldTypeTiles
          value={field.type}
          onPick={(type) => onChange({ type })}
          testId={`field-type-${index}`}
        />
      </FormField>
      <label className="flex items-center gap-2 text-ds-body-sm text-text-primary">
        <Checkbox
          checked={field.required}
          data-testid={`field-required-${index}`}
          onCheckedChange={(value) => onChange({ required: value === true })}
        />
        {m.admin_collection_required()}
      </label>
      <FormField
        label={m.content_field_help()}
        htmlFor={`field-help-${index}`}
        hint={m.content_field_help_hint()}
      >
        <Textarea
          id={`field-help-${index}`}
          data-testid={`field-help-${index}`}
          rows={2}
          value={field.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </FormField>
      {field.type === 'select' ? (
        <FormField
          label={m.admin_collection_options()}
          htmlFor={`field-options-${index}`}
        >
          <Input
            id={`field-options-${index}`}
            data-testid={`field-options-${index}`}
            placeholder={m.admin_collection_options_placeholder()}
            value={field.options}
            onChange={(event) => onChange({ options: event.target.value })}
          />
        </FormField>
      ) : null}
      {field.type === 'reference' ? (
        <FormField
          label={m.admin_collection_field_collection()}
          htmlFor={`field-collection-${index}`}
        >
          <Input
            id={`field-collection-${index}`}
            data-testid={`field-collection-${index}`}
            className="font-mono"
            value={field.collection}
            onChange={(event) => onChange({ collection: event.target.value })}
          />
        </FormField>
      ) : null}
    </div>
  )
}

/** Kept for call sites that only need a plain list with an Add button. */
export function CollectionFieldsEditor({
  fields,
  errors,
  onChange,
}: {
  fields: FieldDraft[]
  errors: FieldErrors
  onChange: (next: FieldDraft[]) => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  if (open !== null && fields[open]) {
    return (
      <FieldFormPanel
        field={fields[open]}
        index={open}
        errors={errors[open]}
        pickingType={false}
        onChange={(patch) =>
          onChange(fields.map((f, i) => (i === open ? { ...f, ...patch } : f)))
        }
        onBack={() => setOpen(null)}
      />
    )
  }
  return (
    <FieldList
      fields={fields}
      errors={errors}
      onChange={onChange}
      onOpen={setOpen}
    />
  )
}
