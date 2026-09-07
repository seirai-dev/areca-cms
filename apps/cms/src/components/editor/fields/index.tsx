import { FormField } from '#/components/form-field'
import type { Field } from '#/lib/types'

import { BooleanFieldInput } from './boolean'
import { DateFieldInput } from './date'
import { DatetimeFieldInput } from './datetime'
import { ImageFieldInput } from './image'
import { NumberFieldInput } from './number'
import { ReferenceFieldInput } from './reference'
import { RichtextFieldInput } from './richtext'
import { SelectFieldInput } from './select'
import { SlugFieldInput } from './slug'
import { TextFieldInput } from './text'
import { TextareaFieldInput } from './textarea'

export function CollectionField({
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
  const id = `field-${field.key}`
  const label = field.required ? `${field.label} *` : field.label

  let control: React.ReactNode
  switch (field.type) {
    case 'text':
      control = (
        <TextFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'textarea':
      control = (
        <TextareaFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'slug':
      control = (
        <SlugFieldInput
          id={id}
          value={value}
          onChange={(next) => onChange(next)}
        />
      )
      break
    case 'select':
      control = (
        <SelectFieldInput
          field={field}
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
        />
      )
  }

  return (
    <FormField label={label} htmlFor={id} error={error}>
      {field.description ? (
        <p className="text-sm text-muted-foreground">{field.description}</p>
      ) : null}
      {control}
    </FormField>
  )
}
