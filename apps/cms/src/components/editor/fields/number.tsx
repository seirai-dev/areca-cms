import { Input } from '#/components/ui/input'

export function NumberFieldInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (value: number | null) => void
}) {
  return (
    <Input
      id={id}
      type="number"
      value={typeof value === 'number' ? value : ''}
      onChange={(event) => {
        const next = event.target.value
        onChange(next === '' ? null : Number(next))
      }}
    />
  )
}
