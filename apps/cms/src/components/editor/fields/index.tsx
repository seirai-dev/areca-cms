import { FormField } from '#/components/form-field'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { BooleanFieldInput } from './boolean'
import { DateFieldInput } from './date'
import { DatetimeFieldInput } from './datetime'
import { ImageFieldInput } from './image'
import { NumberFieldInput } from './number'
import { ReferenceFieldInput } from './reference'
import { RichtextFieldInput } from './richtext'
import { SelectFieldInput } from './select'
import { slugHint, SlugFieldInput } from './slug'
import { TextFieldInput } from './text'
import { TextareaFieldInput } from './textarea'

export function CollectionField({
  field,
  value,
  onChange,
  error,
  siteId,
  organizationId,
  variant = 'default',
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  siteId: string
  organizationId: string
  /**
   * `canvas` renders the field as part of the document body: no box, no label
   * chrome for rich text, a quiet heading for long text.
   */
  variant?: 'default' | 'canvas'
}) {
  const id = `field-${field.key}`
  const invalid = Boolean(error)
  const canvas = variant === 'canvas'

  let control: React.ReactNode
  switch (field.type) {
    case 'text':
      control = (
        <TextFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
          invalid={invalid}
        />
      )
      break
    case 'url':
      control = (
        <TextFieldInput
          id={id}
          type="url"
          value={value}
          onChange={(next) => onChange(next)}
          invalid={invalid}
        />
      )
      break
    case 'textarea':
      control = (
        <TextareaFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
          borderless={canvas}
          placeholder={
            canvas
              ? m.editor_canvas_placeholder({
                  label: field.label.toLocaleLowerCase(),
                })
              : undefined
          }
        />
      )
      break
    case 'slug':
      control = (
        <SlugFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
          invalid={invalid}
        />
      )
      break
    case 'select':
      control = (
        <SelectFieldInput
          field={field}
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'boolean':
      control = (
        <BooleanFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'number':
      control = (
        <NumberFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'date':
      control = (
        <DateFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'datetime':
      control = (
        <DatetimeFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'reference':
      control = (
        <ReferenceFieldInput
          siteId={siteId}
          field={field}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'image':
      control = (
        <ImageFieldInput
          organizationId={organizationId}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'richtext':
      control = (
        <RichtextFieldInput
          value={value}
          onChange={onChange}
          organizationId={organizationId}
        />
      )
      break
    default:
      control = (
        <TextFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
          invalid={invalid}
        />
      )
  }

  if (canvas) {
    return (
      <div
        className="grid gap-2"
        data-field={field.key}
        data-invalid={error ? 'true' : undefined}
      >
        {field.type === 'richtext' ? (
          <label htmlFor={id} className="sr-only">
            {field.label}
          </label>
        ) : (
          <label
            htmlFor={id}
            className="text-ds-label-sm text-text-muted"
          >
            {field.label}
          </label>
        )}
        {control}
        {error ? (
          <p className="text-ds-body-sm text-text-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <FormField
      className="gap-2"
      label={field.label}
      htmlFor={id}
      required={field.required}
      description={field.description}
      hint={field.type === 'slug' ? slugHint() : undefined}
      error={error}
    >
      <div data-field={field.key} className="grid gap-1.5">
        {control}
      </div>
    </FormField>
  )
}
