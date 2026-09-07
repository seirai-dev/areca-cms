import { Input } from '#/components/ui/input'

export function TextFieldInput({
  id,
  value,
  onChange,
  type = 'text',
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
  type?: 'text' | 'url'
}) {
  return (
    <Input
      id={id}
      type={type}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
