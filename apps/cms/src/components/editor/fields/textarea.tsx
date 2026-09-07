import { Textarea } from '#/components/ui/textarea'

export function TextareaFieldInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
}) {
  return (
    <Textarea
      id={id}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
