import { useId } from 'react'
import type { ReactNode } from 'react'

import {
  fieldAria,
  joinDescribedBy,
  withFieldAria,
} from '#/components/ui/field-aria'
import { Label } from '#/components/ui/label'
import { cn } from '#/lib/utils'

/**
 * Label + control + help text + error, laid out consistently across the app.
 *
 * - `required` adds a quiet asterisk (visual) and `aria-required` on the control.
 * - `description` renders between label and control; `hint` renders below
 *   the control as a whisper (format rules).
 * - `error` renders below with `role="alert"` and is referenced from the
 *   control via `aria-describedby`.
 */
export function FormField({
  label,
  htmlFor,
  error,
  required,
  description,
  hint,
  trailing,
  className,
  children,
}: {
  label: ReactNode
  htmlFor?: string
  error?: string
  required?: boolean
  description?: ReactNode
  hint?: ReactNode
  /** Right side of the label row ("Reset from title", a counter). */
  trailing?: ReactNode
  className?: string
  children: ReactNode
}) {
  const generatedId = useId()
  const errorId = htmlFor ? `${htmlFor}-error` : generatedId
  const descriptionId = htmlFor
    ? `${htmlFor}-description`
    : `${generatedId}-description`
  const describedBy = joinDescribedBy(
    description ? descriptionId : undefined,
    error ? errorId : undefined,
  )

  return (
    <div
      className={cn('grid gap-1.5', className)}
      data-invalid={error ? 'true' : undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="inline-flex items-baseline gap-1">
          <Label htmlFor={htmlFor}>{label}</Label>
          {required ? (
            <span aria-hidden="true" className="text-text-muted">
              *
            </span>
          ) : null}
        </span>
        {trailing ? (
          <span className="text-caption font-normal text-text-muted">
            {trailing}
          </span>
        ) : null}
      </div>
      {description ? (
        <p id={descriptionId} className="text-callout text-text-secondary">
          {description}
        </p>
      ) : null}
      {withFieldAria(
        children,
        fieldAria({
          invalid: Boolean(error),
          required,
          describedBy,
        }),
      )}
      {hint && !error ? (
        <p className="text-caption font-normal text-text-muted">{hint}</p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-callout text-text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
