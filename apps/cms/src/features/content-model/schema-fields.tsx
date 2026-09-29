import { Reorder, useDragControls, useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  DotsSixVertical,
  Lock,
  Trash,
} from '@phosphor-icons/react'

import { Tag } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { FormField } from '#/components/ui/form-field'
import { InsetIcon } from '#/components/ui/inset-list'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import { Hint } from '#/components/ui/tooltip'
import type { FieldType } from '#/lib/types'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

import {
  FIELD_TYPE_ICONS,
  PICKABLE_FIELD_TYPES,
  fieldTypeDescription,
  fieldTypeName,
  keyFromLabel,
} from './schema-drafts'
import type { FieldDraft, FieldErrors } from './schema-drafts'

/* -------------------------------------------------------------------------
   Type tiles
------------------------------------------------------------------------- */

/**
 * Grid of field types: the first step of "Add field" (large tiles with a
 * one-line description) and the type control of an open field (`compact`).
 */
export function FieldTypeTiles({
  value,
  onPick,
  compact = false,
  testId,
}: {
  value?: FieldType
  onPick: (type: FieldType) => void
  compact?: boolean
  testId?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-2',
        compact ? 'grid-cols-2 sm:grid-cols-3' : 'sm:grid-cols-2',
      )}
      role="radiogroup"
      aria-label={m.admin_collection_field_type()}
      data-testid={testId}
    >
      {PICKABLE_FIELD_TYPES.map((type) => {
        const active = value === type
        const Icon = FIELD_TYPE_ICONS[type]
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`field-type-tile-${type}`}
            onClick={() => onPick(type)}
            className={cn(
              'group flex items-center gap-3 rounded-[12px] border text-left',
              'transition-[background-color,border-color,box-shadow] duration-150 ease-(--ease-standard)',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
              compact ? 'min-h-11 px-2.5 py-2' : 'p-3',
              active
                ? 'border-accent bg-accent-soft shadow-[0_0_0_1px_var(--color-accent)]'
                : 'border-border-default bg-background-surface hover:border-border-strong hover:bg-surface-state-hover',
            )}
          >
            <InsetIcon
              tone={active ? 'accent' : 'neutral'}
              className={cn(compact && 'size-7 rounded-[8px] [&>svg]:size-4')}
            >
              <Icon weight={active ? 'fill' : 'regular'} />
            </InsetIcon>
            <span className="grid min-w-0 gap-0.5">
              <span
                className={cn(
                  'truncate text-[14px] leading-5 font-medium',
                  active ? 'text-accent-text' : 'text-text-primary',
                  compact && 'text-[13px]',
                )}
              >
                {fieldTypeName(type)}
              </span>
              {compact ? null : (
                <span className="text-callout text-text-secondary">
                  {fieldTypeDescription(type)}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------
   Field list
------------------------------------------------------------------------- */

function RowText({
  field,
  index,
}: {
  field: FieldDraft
  index: number
}) {
  return (
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span
        className="truncate text-[14px] leading-5 font-medium text-text-primary"
        data-testid={`field-label-${index}`}
      >
        {field.label || m.content_field_untitled()}
      </span>
      <span
        className="truncate text-mono text-text-muted"
        data-testid={`field-key-${index}`}
      >
        {field.key || '—'}
      </span>
    </span>
  )
}

function RowType({ field, index }: { field: FieldDraft; index: number }) {
  return (
    <>
      <span
        className="hidden shrink-0 text-callout text-text-secondary sm:inline"
        data-testid={`field-type-${index}`}
        data-type={field.type}
      >
        {fieldTypeName(field.type)}
      </span>
      {field.required ? (
        <Tag tone="neutral" className="shrink-0">
          {m.admin_collection_required()}
        </Tag>
      ) : null}
    </>
  )
}

/** Locked slug row: always first, never dragged or removed. */
function SlugRow({ field }: { field: FieldDraft }) {
  const Icon = FIELD_TYPE_ICONS.slug
  return (
    <li
      data-testid="field-row-0"
      data-locked="true"
      className="relative flex min-h-[60px] items-center gap-3 px-3 py-2.5 after:absolute after:right-0 after:bottom-0 after:left-[92px] after:h-px after:bg-border-default"
    >
      <Hint label={m.admin_collection_slug_field_hint()}>
        <span
          tabIndex={0}
          aria-label={m.content_field_locked()}
          className="grid size-7 shrink-0 place-content-center rounded-[8px] text-icon-muted outline-none focus-visible:outline-2 focus-visible:outline-border-focus"
        >
          <Lock className="size-4" />
        </span>
      </Hint>
      <InsetIcon>
        <Icon />
      </InsetIcon>
      <RowText field={field} index={0} />
      <RowType field={field} index={0} />
    </li>
  )
}

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
  const reduce = useReducedMotion()
  const Icon = FIELD_TYPE_ICONS[field.type]

  return (
    <Reorder.Item
      value={field}
      dragListener={false}
      dragControls={controls}
      data-testid={`field-row-${index}`}
      data-invalid={invalid ? 'true' : undefined}
      layout={reduce ? false : 'position'}
      whileDrag={
        reduce
          ? undefined
          : {
              scale: 1.015,
              boxShadow: 'var(--shadow-float)',
              borderRadius: 12,
              zIndex: 5,
            }
      }
      className={cn(
        'group relative flex min-h-[60px] items-center gap-3 bg-background-surface px-3 py-2.5',
        'after:absolute after:right-0 after:bottom-0 after:left-[92px] after:h-px after:bg-border-default last:after:hidden',
        invalid && 'bg-status-error-bg/40',
      )}
    >
      <button
        type="button"
        aria-label={m.content_reorder_field({
          label: field.label || m.content_field_untitled(),
        })}
        onPointerDown={(event) => controls.start(event)}
        className="grid size-7 shrink-0 cursor-grab touch-none place-content-center rounded-[8px] text-icon-muted outline-none hover:bg-surface-state-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus active:cursor-grabbing"
      >
        <DotsSixVertical weight="bold" className="size-4" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <InsetIcon tone={invalid ? 'error' : 'neutral'}>
          <Icon />
        </InsetIcon>
        <RowText field={field} index={index} />
        <RowType field={field} index={index} />
      </button>
      <Hint label={m.admin_collection_remove_field()}>
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          className="shrink-0 text-icon-muted hover:text-text-error"
          aria-label={m.admin_collection_remove_field()}
          onClick={onRemove}
        >
          <Trash />
        </Button>
      </Hint>
    </Reorder.Item>
  )
}

/**
 * The reorderable field list, as one inset card. Row 0 is the locked slug
 * field; every other row opens the field form.
 */
export function FieldList({
  fields,
  errors,
  onChange,
  onOpen,
  onRemove,
}: {
  fields: FieldDraft[]
  errors: FieldErrors
  onChange: (next: FieldDraft[]) => void
  onOpen: (index: number) => void
  onRemove: (index: number) => void
}) {
  const [slug, ...rest] = fields

  return (
    <div className="overflow-hidden surface-card" data-testid="field-list">
      <ol>
        <SlugRow field={slug} />
      </ol>
      <Reorder.Group
        axis="y"
        as="ol"
        values={rest}
        onReorder={(next: FieldDraft[]) => onChange([slug, ...next])}
        className="relative"
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
              onRemove={() => onRemove(index)}
            />
          )
        })}
      </Reorder.Group>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Field form
------------------------------------------------------------------------- */

function BackHeader({
  title,
  onBack,
  subtitle,
}: {
  title: string
  subtitle?: string
  onBack: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="quiet"
        size="icon-sm"
        onClick={onBack}
        aria-label={m.content_back_to_fields()}
        data-testid="field-back"
      >
        <ArrowLeft />
      </Button>
      <div className="grid min-w-0">
        <p className="truncate text-headline text-text-primary">{title}</p>
        {subtitle ? (
          <p className="truncate text-caption font-normal text-text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Edits one field. Rendered instead of the list so the `field-*-N` ids stay
 * unique; `pickingType` shows the tile grid first.
 */
export function FieldFormPanel({
  field,
  index,
  errors,
  pickingType,
  collectionKeys,
  onChange,
  onBack,
  onRemove,
}: {
  field: FieldDraft
  index: number
  errors: FieldErrors[number]
  pickingType: boolean
  /** The site's collections, for the reference target picker. */
  collectionKeys: { key: string; label: string }[]
  onChange: (patch: Partial<FieldDraft>) => void
  onBack: () => void
  onRemove: () => void
}) {
  if (pickingType) {
    return (
      <div className="grid gap-4" data-testid="field-type-picker">
        <BackHeader
          title={m.admin_collection_add_field()}
          subtitle={m.admin_field_picker_description()}
          onBack={onBack}
        />
        <FieldTypeTiles
          onPick={(type) => onChange({ type })}
          testId={`field-type-${index}`}
        />
      </div>
    )
  }

  const targets = collectionKeys.some((item) => item.key === field.collection)
    ? collectionKeys
    : field.collection
      ? [...collectionKeys, { key: field.collection, label: field.collection }]
      : collectionKeys

  return (
    <div className="grid gap-5" data-testid="field-form">
      <BackHeader
        title={field.label || m.content_field_untitled()}
        subtitle={fieldTypeName(field.type)}
        onBack={onBack}
      />
      <div className="grid gap-4 surface-card p-4">
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
            autoFocus={!field.label}
            aria-invalid={errors?.label ? true : undefined}
            placeholder={m.content_field_label_placeholder()}
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
          hint={m.content_field_key_hint()}
          required
        >
          <Input
            id={`field-key-${index}`}
            data-testid={`field-key-${index}`}
            className="font-mono text-[13px]"
            value={field.key}
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={errors?.key ? true : undefined}
            onChange={(event) =>
              onChange({ key: event.target.value, keyTouched: true })
            }
          />
        </FormField>
        {field.type === 'select' ? (
          <FormField
            label={m.admin_collection_options()}
            htmlFor={`field-options-${index}`}
            hint={m.content_field_options_hint()}
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
            label={m.content_field_reference_target()}
            htmlFor={`field-collection-${index}`}
            hint={m.content_field_reference_target_hint()}
          >
            <Select
              value={field.collection || undefined}
              onValueChange={(value) => onChange({ collection: value })}
            >
              <SelectTrigger
                id={`field-collection-${index}`}
                data-testid={`field-collection-${index}`}
                className="w-full"
              >
                <SelectValue placeholder={m.content_choose_collection()} />
              </SelectTrigger>
              <SelectContent>
                {targets.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    <span>{item.label}</span>
                    <span className="text-mono text-text-muted">{item.key}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
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
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 surface-card px-4 py-3">
        <span className="grid gap-0.5">
          <span className="text-[14px] leading-5 font-medium text-text-primary">
            {m.admin_collection_required()}
          </span>
          <span className="text-callout text-text-secondary">
            {m.content_field_required_hint()}
          </span>
        </span>
        <Switch
          checked={field.required}
          data-testid={`field-required-${index}`}
          aria-label={m.admin_collection_required()}
          onCheckedChange={(value) => onChange({ required: value === true })}
        />
      </label>

      <div className="grid gap-2">
        <p className="px-1 text-overline text-text-muted">
          {m.admin_collection_field_type()}
        </p>
        <FieldTypeTiles
          compact
          value={field.type}
          onPick={(type) => onChange({ type })}
          testId={`field-type-${index}`}
        />
      </div>

      <div>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          className="text-text-error hover:text-text-error"
          onClick={onRemove}
        >
          <Trash />
          {m.admin_collection_remove_field()}
        </Button>
      </div>
    </div>
  )
}
