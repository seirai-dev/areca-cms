import { Input } from '#/components/ui/input'

export function TextFieldInput({
  id,
  value,
  onChange,
  type = 'text',
  invalid,
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
  type?: 'text' | 'url'
  invalid?: boolean
}) {
  return (
    <Input
      id={id}
      type={type}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      placeholder={type === 'url' ? 'https://' : undefined}
    />
  )
}
