import { useId } from 'react'
import type { ReactNode } from 'react'

import { Label } from '#/components/ui/label'
import { cn } from '#/lib/utils'

/**
 * Label + control + help text + error, laid out consistently across the app.
 *
 * - `required` adds a quiet asterisk (visual only; put `required` on the
 *   control itself).
 * - `description` renders between label and control; `hint` renders below
 *   the control as a whisper (format rules).
 * - `error` renders below with `role="alert"`.
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
  const errorId = useId()

  return (
    <div
      className={cn('grid gap-1.5', className)}
      data-invalid={error ? 'true' : undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor} className="gap-1">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-text-muted">
              *
            </span>
          ) : null}
        </Label>
        {trailing ? (
          <span className="text-caption font-normal text-text-muted">{trailing}</span>
        ) : null}
      </div>
      {description ? (
        <p className="text-callout text-text-secondary">{description}</p>
      ) : null}
      {children}
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
