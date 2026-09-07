import { Switch } from '#/components/ui/switch'

export function BooleanFieldInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (value: boolean) => void
}) {
  return (
    <Switch
      id={id}
      checked={value === true}
      onCheckedChange={onChange}
    />
  )
}
