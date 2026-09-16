import type { Field } from '#/lib/types'
import { m } from '#/paraglide/messages'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

export function SelectFieldInput({
  field,
  id,
  value,
  onChange,
}: {
  field: Field
  id?: string
  value: unknown
  onChange: (value: string) => void
}) {
  const current = typeof value === 'string' && value ? value : undefined
  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full" id={id ?? `field-${field.key}`}>
        <SelectValue placeholder={m.editor_select_placeholder()} />
      </SelectTrigger>
      <SelectContent>
        {(field.options ?? []).map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
