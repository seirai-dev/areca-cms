import type { Field } from '#/lib/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

export function SelectFieldInput({
  field,
  value,
  onChange,
}: {
  field: Field
  value: unknown
  onChange: (value: string) => void
}) {
  const current = typeof value === 'string' && value ? value : undefined
  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full" id={field.key}>
        <SelectValue placeholder="Select…" />
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
