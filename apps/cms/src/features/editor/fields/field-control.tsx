import { FormField } from '#/components/ui/form-field'
import { Input } from '#/components/ui/input'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '#/components/editor/utils'
import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'

import { ImageWell } from './image-well'
import { ReferencePicker } from './reference-picker'

export function fieldId(field: Field) {
  return `field-${field.key}`
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * One structured field in the details panel (brief §3.5): label on top,
 * then the control. Booleans are a switch row, short choice lists a
 * segmented control, images a thumbnail well, references a searchable
 * picker. The control carries `id="field-{key}"` (so labels resolve) and the
 * wrapper `data-field="{key}"` (so errors can scroll into view).
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

  if (field.type === 'boolean') {
    const checked = value === true
    return (
      <div data-field={field.key} data-invalid={invalid ? 'true' : undefined} className="grid gap-1.5">
        <div className="flex items-center justify-between gap-4 rounded-[10px] border border-border-default bg-background-surface px-3 py-2.5">
          <label htmlFor={id} className="grid min-w-0 cursor-pointer gap-0.5">
            <span className="text-[14px] leading-5 font-medium text-text-primary">
              {field.label}
              {field.required ? (
                <span aria-hidden="true" className="ml-1 text-text-muted">
                  *
                </span>
              ) : null}
            </span>
            {field.description ? (
              <span className="text-caption font-normal text-text-muted">
                {field.description}
              </span>
            ) : null}
          </label>
          <Switch id={id} checked={checked} onCheckedChange={(next) => onChange(next)} />
        </div>
        {error ? (
          <p className="text-callout text-text-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  let control: React.ReactNode
  switch (field.type) {
    case 'select': {
      const options = field.options ?? []
      const current = typeof value === 'string' && value ? value : ''
      control =
        options.length > 0 && options.length <= 4 ? (
          <div className="grid gap-1">
            <SegmentedControl
              fullWidth
              size="sm"
              aria-label={field.label}
              value={current}
              onValueChange={(next) => onChange(next)}
              options={options.map((option) => ({
                value: option,
                label: option,
                testId: `${id}-${option}`,
              }))}
              data-testid={id}
            />
            {current && !field.required ? (
              <button
                type="button"
                onClick={() => onChange('')}
                className="w-fit text-caption font-normal text-text-muted hover:text-text-primary hover:underline"
              >
                {m.editor_clear_choice()}
              </button>
            ) : null}
          </div>
        ) : (
          <Select value={current || undefined} onValueChange={(next) => onChange(next)}>
            <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
              <SelectValue placeholder={m.editor_select_placeholder()} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      break
    }
    case 'image':
      control = (
        <ImageWell
          id={id}
          organizationId={organizationId}
          value={value}
          onChange={onChange}
          invalid={invalid}
        />
      )
      break
    case 'reference':
      control = (
        <ReferencePicker
          id={id}
          siteId={siteId}
          field={field}
          value={value}
          onChange={onChange}
          invalid={invalid}
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
          onChange={(event) => onChange(fromDatetimeLocalValue(event.target.value))}
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

  return (
    <div data-field={field.key} className="grid grid-cols-[minmax(0,1fr)]">
      <FormField
        label={field.label}
        htmlFor={
          field.type === 'image' ||
          (field.type === 'select' && (field.options?.length ?? 0) <= 4)
            ? undefined
            : id
        }
        required={field.required}
        description={field.description}
        error={error}
      >
        {control}
      </FormField>
    </div>
  )
}
