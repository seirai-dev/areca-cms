import { useId } from 'react'
import type { ReactNode } from 'react'

import { Label } from '#/components/ui/label'
import { cn } from '#/lib/utils'

/**
 * Label + control + help text + error, laid out consistently across the app.
 *
 * - `required` adds a red asterisk (visually only; put `required`/`aria-required`
 *   on the control itself).
 * - `description` renders between label and control; `hint` renders below the
 *   control in smaller text (use for format rules).
 */
export function FormField({
  label,
  htmlFor,
  error,
  required,
  description,
  hint,
  className,
  children,
}: {
  label: ReactNode
  htmlFor?: string
  error?: string
  required?: boolean
  description?: ReactNode
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  const errorId = useId()

  return (
    <div
      className={cn('grid gap-1.5', className)}
      data-invalid={error ? 'true' : undefined}
    >
      <Label htmlFor={htmlFor} className="gap-1">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-text-error">
            *
          </span>
        ) : null}
      </Label>
      {description ? (
        <p className="text-ds-body-sm text-text-secondary">{description}</p>
      ) : null}
      {children}
      {hint && !error ? (
        <p className="text-ds-body-xs text-text-muted">{hint}</p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="text-ds-body-sm text-text-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
