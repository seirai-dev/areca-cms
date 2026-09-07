import { Input } from '#/components/ui/input'

import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../utils'

export function DatetimeFieldInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
}) {
  return (
    <Input
      id={id}
      type="datetime-local"
      value={toDatetimeLocalValue(value)}
      onChange={(event) => onChange(fromDatetimeLocalValue(event.target.value))}
    />
  )
}
