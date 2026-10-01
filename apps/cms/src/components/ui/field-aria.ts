import { cloneElement, createElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

export type FieldAria = {
  'aria-invalid'?: boolean
  'aria-required'?: boolean
  'aria-describedby'?: string
}

export function joinDescribedBy(
  ...ids: Array<string | undefined | false>
): string | undefined {
  const joined = ids.filter((id): id is string => Boolean(id)).join(' ')
  return joined || undefined
}

export function fieldAria({
  invalid,
  required,
  describedBy,
}: {
  invalid?: boolean
  required?: boolean
  describedBy?: string
}): FieldAria {
  return {
    ...(invalid ? { 'aria-invalid': true } : {}),
    ...(required ? { 'aria-required': true } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  }
}

export function withFieldAria(child: ReactNode, aria: FieldAria): ReactNode {
  if (isValidElement(child)) {
    const existing = (child.props as { 'aria-describedby'?: string })[
      'aria-describedby'
    ]
    const describedBy = joinDescribedBy(existing, aria['aria-describedby'])
    return cloneElement(child as ReactElement<FieldAria>, {
      ...aria,
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    })
  }
  return createElement('div', { role: 'group', ...aria }, child)
}
