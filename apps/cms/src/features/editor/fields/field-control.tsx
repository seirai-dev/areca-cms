import { fieldAria } from '#/components/ui/field-aria'
import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '#/lib/content/utils'
import type { Field } from '#/lib/types'

import { isTranslatable } from '#/lib/content-locale'
import { MainReference } from '../main-reference'
import { SharedMarker, useLocaleFields } from '../locale-fields'

import { ImageWell } from './image-well'
import { ReferencePicker } from './reference-picker'
import { SelectFieldControl } from './select-field'

function fieldId(field: Field) {
  return `field-${field.key}`
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * One structured field in the details panel (brief §3.5): label on top,
 * then the control. Booleans are a switch row, short choice lists a
 * segmented control when it fits (see `SelectFieldControl`), images a
 * thumbnail well, references a searchable picker. The control carries
 * `id="field-{key}"` (so labels resolve) and the wrapper `data-field="{key}"`
 * (so errors can scroll into view).
 */
export function FieldControl({
  field,
  value,
  onChange,
  error,
  siteId,
  organizationId,
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  siteId: string
  organizationId: string
}) {
  const id = fieldId(field)
  const invalid = Boolean(error)
  // Content languages: the main value under translatable fields, and a
  // "Same in all languages" marker on shared ones. Both are null on
  // single-language sites and on the main language.
  const locale = useLocaleFields()
  const notMain = locale !== null && !locale.isMain
  const translatable = isTranslatable(field)
  const shared = notMain && !translatable ? <SharedMarker /> : null
  const reference =
    notMain && translatable ? (
      <MainReference
        fieldKey={field.key}
        type={field.type}
        value={locale.mainView[field.key]}
        mainCode={locale.main.toUpperCase()}
        mainName={locale.mainName}
        onCopy={(next) => onChange(next)}
      />
    ) : null

  if (field.type === 'select') {
    const select = (
      <SelectFieldControl
        field={field}
        id={id}
        value={value}
        onChange={onChange}
        error={error}
        trailing={shared}
      />
    )
    return reference ? (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {reference}
        {select}
      </div>
    ) : (
      select
    )
  }

  if (field.type === 'boolean') {
    const checked = value === true
    const errorId = `${id}-error`
    return (
      <div
        data-field={field.key}
        data-invalid={invalid ? 'true' : undefined}
        className="grid gap-2"
      >
        {reference}
        <div className="flex items-center justify-between gap-4 rounded-[10px] border border-border-default bg-background-surface px-3 py-2.5">
          <label htmlFor={id} className="grid min-w-0 cursor-pointer gap-0.5">
            <span className="text-[14px] leading-5 font-medium text-text-primary">
              {field.label}
              {field.required ? (
                <span aria-hidden="true" className="ml-1 text-text-muted">
                  *
                </span>
              ) : null}
              {shared ? (
                <span className="ml-2 inline-flex">{shared}</span>
              ) : null}
            </span>
            {field.description ? (
              <span className="text-caption font-normal text-text-muted">
                {field.description}
              </span>
            ) : null}
          </label>
          <Switch
            id={id}
            checked={checked}
            onCheckedChange={(next) => onChange(next)}
            {...fieldAria({
              invalid,
              required: field.required,
              describedBy: error ? errorId : undefined,
            })}
          />
        </div>
        {error ? (
          <p id={errorId} className="text-callout text-text-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  let control: React.ReactNode
  switch (field.type) {
    case 'image':
      control = (
        <div role="group">
          <ImageWell
            id={id}
            organizationId={organizationId}
            value={value}
            onChange={onChange}
            invalid={invalid}
          />
        </div>
      )
      break
    case 'reference':
      control = (
        <div role="group">
          <ReferencePicker
            id={id}
            siteId={siteId}
            field={field}
            value={value}
            onChange={onChange}
            invalid={invalid}
          />
        </div>
      )
      break
    case 'textarea':
      control = (
        <Textarea
          id={id}
          value={text(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )
      break
    case 'number':
      control = (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? value : ''}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const next = event.target.value
            onChange(next === '' ? null : Number(next))
          }}
        />
      )
      break
    case 'date':
      control = (
        <Input
          id={id}
          type="date"
          value={text(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )
      break
    case 'datetime':
      control = (
        <Input
          id={id}
          type="datetime-local"
          value={toDatetimeLocalValue(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) =>
            onChange(fromDatetimeLocalValue(event.target.value))
          }
        />
      )
      break
    case 'url':
      control = (
        <Input
          id={id}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={text(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )
      break
    case 'slug':
      control = (
        <Input
          id={id}
          value={text(value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="font-mono text-[13px]"
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )
      break
    default:
      control = (
        <Input
          id={id}
          value={text(value)}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }

  // The reference row sits above the field, outside FormField: FormField
  // only passes its ARIA wiring to a single child element.
  return (
    <div
      data-field={field.key}
      className="grid grid-cols-[minmax(0,1fr)] gap-2"
    >
      {reference}
      <FormField
        label={field.label}
        htmlFor={field.type === 'image' ? undefined : id}
        required={field.required}
        description={field.description}
        error={error}
        trailing={shared}
      >
        {control}
      </FormField>
    </div>
  )
}
