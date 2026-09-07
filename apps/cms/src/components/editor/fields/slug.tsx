import { Input } from '#/components/ui/input'

export function SlugFieldInput({
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
