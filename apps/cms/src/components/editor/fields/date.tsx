import { Input } from '#/components/ui/input'

export function DateFieldInput({
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
      type="date"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
