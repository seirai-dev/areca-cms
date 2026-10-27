import { Fragment } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Trash } from '@phosphor-icons/react'

import { Button } from '#/components/ui/button'

/**
 * The metadata line of a key or app row ("Created … · Never used · Never
 * expires"). On phones each item gets its own line; from `sm` up they share
 * one line with "·" separators.
 */
export function RowMeta({
  items,
  title,
}: {
  items: ReactNode[]
  title?: string
}) {
  return (
    <span
      className="flex min-w-0 flex-col gap-y-0.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-y-0"
      title={title}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span
              aria-hidden="true"
              className="hidden whitespace-pre sm:inline"
            >
              {' · '}
            </span>
          ) : null}
          <span className="whitespace-nowrap">{item}</span>
        </Fragment>
      ))}
    </span>
  )
}

/**
 * The row's Revoke or Disconnect button. From `sm` up it shows icon and text;
 * below that it is an icon-only square. The label is the full text in both
 * the aria-label and the title, so the action is never unnamed.
 */
export function RowActionButton({
  label,
  text,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  /** The full action text, e.g. "Revoke: Laptop". */
  label: string
  /** The visible text shown from `sm` up, e.g. "Revoke". */
  text: string
}) {
  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      className="min-h-11 max-sm:size-11 max-sm:px-0 sm:min-h-0"
      aria-label={label}
      title={label}
      {...props}
    >
      <Trash />
      <span className="hidden sm:inline">{text}</span>
    </Button>
  )
}
