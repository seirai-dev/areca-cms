import { Input } from '#/components/ui/input'

export function TextFieldInput({
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
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
