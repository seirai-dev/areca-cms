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
  const checked = value === true
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <span className="text-sm text-muted-foreground">
        {checked ? 'Yes' : 'No'}
      </span>
    </div>
  )
}
