import * as React from 'react'
import { PencilSimple } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

/**
 * The auto-suggested short name (slug), shown as a whisper under the name
 * with an Edit affordance (brief §3.11). It is always a real input (so the
 * value is submitted and testable); until "Edit" it reads as quiet mono text.
 */
export function SlugField({
  id,
  value,
  onChange,
  touched,
  onTouched,
  hint,
  testId,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  touched: boolean
  onTouched: () => void
  hint: string
  testId: string
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  const editing = touched
  return (
    <div className="grid gap-1" data-editing={editing ? 'true' : 'false'}>
      <div
        className={cn(
          'flex min-h-9 items-center gap-2 rounded-control transition-[background-color,border-color,box-shadow]',
          editing
            ? 'border border-border-strong bg-background-surface pr-1 pl-3 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft'
            : 'bg-background-subtle pr-1 pl-3',
        )}
      >
        <label
          htmlFor={id}
          className="shrink-0 text-caption font-normal text-text-muted"
        >
          {m.agency_slug_label()}
        </label>
        <input
          ref={ref}
          id={id}
          data-testid={testId}
          required
          readOnly={!editing}
          autoComplete="off"
          spellCheck={false}
          placeholder={m.agency_slug_placeholder()}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'h-8 min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-text-primary outline-none placeholder:font-sans placeholder:text-text-muted',
            !editing && 'cursor-default text-text-secondary',
          )}
        />
        {editing ? null : (
          <Button
            type="button"
            variant="quiet"
            size="xs"
            onClick={() => {
              onTouched()
              requestAnimationFrame(() => {
                ref.current?.focus()
                ref.current?.select()
              })
            }}
            data-testid={`${testId}-edit`}
          >
            <PencilSimple />
            {m.agency_slug_edit()}
          </Button>
        )}
      </div>
      <p className="px-1 text-caption font-normal text-text-muted">{hint}</p>
    </div>
  )
}
