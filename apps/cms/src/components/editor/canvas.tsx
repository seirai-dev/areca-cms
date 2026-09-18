import type { EntryData, Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { CollectionField } from './fields'
import type { FieldErrorMap } from './utils'

/**
 * The writing surface: a borderless title, then every long-form field as the
 * document body. Nothing here is boxed; whitespace does the separating.
 */
export function EntryCanvas({
  titleField,
  canvasFields,
  data,
  errors,
  onChange,
  siteId,
  organizationId,
}: {
  titleField?: Field
  canvasFields: Field[]
  data: EntryData
  errors: FieldErrorMap
  onChange: (key: string, value: unknown) => void
  siteId: string
  organizationId: string
}) {
  return (
    <div className="mx-auto grid w-full max-w-[760px] min-w-0 gap-8">
      {titleField ? (
        <div
          className="grid gap-1.5"
          data-field={titleField.key}
          data-invalid={errors[titleField.key] ? 'true' : undefined}
        >
          <label htmlFor={`field-${titleField.key}`} className="sr-only">
            {titleField.label}
          </label>
          <input
            id={`field-${titleField.key}`}
            type="text"
            value={
              typeof data[titleField.key] === 'string'
                ? (data[titleField.key] as string)
                : ''
            }
            onChange={(event) => onChange(titleField.key, event.target.value)}
            aria-invalid={errors[titleField.key] ? true : undefined}
            placeholder={m.editor_untitled()}
            className="w-full border-0 bg-transparent text-ds-heading-1 text-text-primary outline-none placeholder:text-text-disabled focus-visible:outline-none"
          />
          {errors[titleField.key] ? (
            <p className="text-ds-body-sm text-text-error" role="alert">
              {errors[titleField.key]}
            </p>
          ) : null}
        </div>
      ) : null}

      {canvasFields.map((field) => (
        <CollectionField
          key={field.key}
          field={field}
          value={data[field.key]}
          onChange={(value) => onChange(field.key, value)}
          error={errors[field.key]}
          siteId={siteId}
          organizationId={organizationId}
          variant="canvas"
        />
      ))}
    </div>
  )
}
